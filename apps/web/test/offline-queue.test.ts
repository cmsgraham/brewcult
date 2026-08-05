/**
 * Offline-first mechanics (docs/brew_logger_ux.md §5, EF §2.2).
 *
 * The promises being tested:
 *   - the session is persisted locally *before* the network is involved;
 *   - a retried sync can never double-log (client UUIDv7 + idempotent PUT, and
 *     one queue entry per resource id however many times it is enqueued);
 *   - the queue replays on reconnect, with backoff in between;
 *   - a draft survives a reload.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import {
  buildPayback,
  createLogTimer,
  defaultPrefill,
  draftFromPrefill,
  emitTimeToLog,
  ratingsTrendingUp,
  sessionFromDraft,
  setNumericField,
  TIME_TO_LOG_EVENT,
  type LocalBrewRecord,
  type TimeToLogMeasurement,
} from '../lib/brewing-client';
import { createBrewEngine, KEYS } from '../lib/offline/engine';
import { backoffDelay, SyncQueue, type QueuedMutation } from '../lib/offline/queue';
import { createMemoryStore } from '../lib/offline/store';
import { isUuidV7, uuidv7, uuidV7Timestamp } from '../lib/uuid';

function draft() {
  return draftFromPrefill(defaultPrefill(), {
    coffee: { id: 'coffee-1', label: 'Ethiopia Chelbesa' },
  });
}

function record(id: string): LocalBrewRecord {
  return {
    session: sessionFromDraft(draft(), { id, source: 'repeat' }),
    coffee_label: 'Ethiopia Chelbesa',
    brewer_label: 'V60',
    synced: false,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('client-minted ids', () => {
  it('mints sortable v7 ids that never collide inside one millisecond', () => {
    const ids = Array.from({ length: 500 }, () => uuidv7(1_770_000_000_000));
    expect(new Set(ids).size).toBe(500);
    expect(ids.every(isUuidV7)).toBe(true);
    expect([...ids].sort()).toEqual(ids);
    expect(uuidV7Timestamp(ids[0] as string)).toBe(1_770_000_000_000);
  });
});

describe('sync queue', () => {
  it('keeps one entry per resource id, however many times it is enqueued', async () => {
    const store = createMemoryStore();
    const send = vi.fn(async () => undefined);
    const queue = new SyncQueue({ store, send });
    const id = uuidv7();

    await queue.enqueue({ id, type: 'brew_session', method: 'PUT', path: `/api/v1/brews/${id}`, body: { v: 1 } });
    await queue.enqueue({ id, type: 'brew_session', method: 'PUT', path: `/api/v1/brews/${id}`, body: { v: 2 } });

    const pending = await queue.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.body).toEqual({ v: 2 });

    await queue.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await queue.pending()).toHaveLength(0);
  });

  it('holds the mutation and backs off when the network is gone', async () => {
    const store = createMemoryStore();
    let now = 1_000;
    const send = vi.fn(async (): Promise<void> => {
      throw new ApiError(0, { error: 'network_error', message: '' });
    });
    const queue = new SyncQueue({
      store,
      send,
      now: () => now,
      baseDelayMs: 100,
      isTransportError: (error) => error instanceof ApiError && error.status === 0,
    });

    const id = uuidv7();
    await queue.enqueue({ id, type: 'brew_session', method: 'PUT', path: `/api/v1/brews/${id}`, body: {} });
    await queue.flush();

    const [pending] = await queue.pending();
    expect(pending?.attempts).toBe(1);
    expect(pending?.next_attempt_at).toBe(now + backoffDelay(1, 100, 300_000));
    expect(queue.getState().pending).toBe(1);
    expect(queue.getState().lastError).not.toBeNull();

    // Not due yet — a flush now must not hammer the socket.
    await queue.flush();
    expect(send).toHaveBeenCalledTimes(1);

    now += 1_000;
    send.mockImplementation(async () => undefined);
    await queue.flush();
    expect(await queue.pending()).toHaveLength(0);
  });

  it('stops walking the queue once the transport is down', async () => {
    const store = createMemoryStore();
    const send = vi.fn(async () => {
      throw new ApiError(0, { error: 'network_error', message: '' });
    });
    const queue = new SyncQueue({
      store,
      send,
      isTransportError: () => true,
    });

    for (const body of [1, 2, 3]) {
      const id = uuidv7();
      await queue.enqueue({ id, type: 'brew_session', method: 'PUT', path: `/api/v1/brews/${id}`, body });
    }
    await queue.flush();

    expect(send).toHaveBeenCalledTimes(1);
    expect(await queue.pending()).toHaveLength(3);
  });

  it('drops a mutation the server permanently rejects, and says so', async () => {
    const store = createMemoryStore();
    const send = vi.fn(async () => {
      throw new ApiError(422, { error: 'validation_error', message: 'nope' });
    });
    const queue = new SyncQueue({
      store,
      send,
      isPermanentError: (error) => error instanceof ApiError && error.status === 422,
    });

    const id = uuidv7();
    await queue.enqueue({ id, type: 'brew_session', method: 'PUT', path: `/api/v1/brews/${id}`, body: {} });
    await queue.flush();

    expect(await queue.pending()).toHaveLength(0);
    expect(queue.getState().dropped).toBe(1);
  });
});

describe('engine — optimistic local write', () => {
  it('persists the session even when the request rejects, then replays on reconnect', async () => {
    const store = createMemoryStore();
    const puts: string[] = [];
    let online = false;

    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (!online) throw new TypeError('Failed to fetch');
      if (init?.method === 'PUT') puts.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'x', applied: 'created', updated_at: '2026-08-04T00:00:00Z' }),
      } as unknown as Response;
    });

    const engine = createBrewEngine({ store, fetchImpl, baseDelayMs: 5 });
    const id = uuidv7();
    await engine.logBrew(record(id));
    await engine.queue.flush();

    // The brew is on the device regardless of the network.
    const stored = await store.get<LocalBrewRecord>(KEYS.session(id));
    expect(stored?.session.id).toBe(id);
    expect(stored?.synced).toBe(false);
    expect(await engine.queue.pending()).toHaveLength(1);
    expect(puts).toHaveLength(0);

    online = true;
    engine.start();
    window.dispatchEvent(new Event('online'));

    await vi.waitFor(async () => {
      expect(await engine.queue.pending()).toHaveLength(0);
    });
    engine.stop();

    expect(puts).toEqual([`/api/v1/brews/${id}`]);
    expect((await store.get<LocalBrewRecord>(KEYS.session(id)))?.synced).toBe(true);
  });

  it('never double-logs when the same session is queued twice', async () => {
    const store = createMemoryStore();
    const puts: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') puts.push(url);
      return { ok: true, status: 200, json: async () => ({ applied: 'updated' }) } as unknown as Response;
    });

    const engine = createBrewEngine({ store, fetchImpl, baseDelayMs: 5 });
    const id = uuidv7();
    const first = record(id);

    // Log, then rate the same brew before the first sync lands.
    await engine.queue.enqueue({
      id,
      type: 'brew_session',
      method: 'PUT',
      path: `/api/v1/brews/${id}`,
      body: first.session,
    });
    await engine.amendBrew({ ...first.session, taste: { verdict: 'good' } });

    expect(await engine.queue.pending()).toHaveLength(1);
    await engine.queue.flush();

    expect(puts).toEqual([`/api/v1/brews/${id}`]);
    const stored = await store.get<LocalBrewRecord>(KEYS.session(id));
    expect(stored?.session.taste?.verdict).toBe('good');
  });
});

describe('drafts survive interruption', () => {
  it('reloads an unfinished draft from the device', async () => {
    const store = createMemoryStore();
    const first = createBrewEngine({ store });
    const edited = setNumericField(draft(), 'grind', 7);
    await first.saveDraft('coffee-1', edited);

    // A "reload": brand new engine instance over the same storage.
    const second = createBrewEngine({ store });
    const restored = await second.loadDraft('coffee-1');

    expect(restored?.grind_setting).toBe('7');
    expect(restored?.changed).toEqual(['grind']);
  });

  it('keeps a running timer honest across a reload — elapsed is derived, not counted', async () => {
    const store = createMemoryStore();
    const startedAt = Date.now() - 90_000;
    await createBrewEngine({ store }).saveDraft('coffee-1', {
      ...draft(),
      timer_started_at: startedAt,
    });

    const restored = await createBrewEngine({ store }).loadDraft('coffee-1');
    const elapsed = Math.round((Date.now() - (restored?.timer_started_at ?? 0)) / 1000);
    expect(elapsed).toBeGreaterThanOrEqual(90);
  });
});

describe('post-log payback (§6)', () => {
  it('suggests a fix after a bitter brew, warmly', () => {
    const payback = buildPayback({
      brewCountForBag: 3,
      verdict: 'bitter',
      priorVerdicts: ['good', 'good'],
      changed: [],
    });
    expect(payback.line).toMatch(/3rd brew of this bag/);
    expect(payback.line).toMatch(/that happens/i);
    expect(payback.suggestion).toEqual({ text: expect.any(String), field: 'grind', delta: 0.5 });
  });

  it('claims a trend only when the ratings support it', () => {
    expect(ratingsTrendingUp(['bitter', 'sour', 'good', 'good'])).toBe(true);
    expect(ratingsTrendingUp(['good', 'good', 'bitter', 'sour'])).toBe(false);
    expect(ratingsTrendingUp(['good', 'good'])).toBe(false);
  });

  it('never mentions a streak', () => {
    for (const count of [1, 2, 5, 21]) {
      const payback = buildPayback({
        brewCountForBag: count,
        verdict: 'good',
        priorVerdicts: ['good', 'good', 'good'],
        changed: [],
      });
      expect(payback.line.toLowerCase()).not.toContain('streak');
      expect(payback.line.toLowerCase()).not.toMatch(/don't break|keep it going/);
    }
  });
});

describe('instrumentation (§7)', () => {
  it('measures card-open to persisted-locally and publishes it', () => {
    let clock = 0;
    const timer = createLogTimer(() => clock);
    clock = 1_200;
    timer.noteInteraction();
    clock = 3_400;

    const measurement = timer.measure({
      path: 'A',
      source: 'repeat',
      session_id: uuidv7(),
      offline: false,
    });
    expect(measurement.ms).toBe(3_400);
    expect(measurement.ms_since_first_input).toBe(2_200);
    expect(measurement.interactions).toBe(1);

    const received: TimeToLogMeasurement[] = [];
    const listener = (event: Event) =>
      received.push((event as CustomEvent<TimeToLogMeasurement>).detail);
    window.addEventListener(TIME_TO_LOG_EVENT, listener);
    const callback = vi.fn();
    emitTimeToLog(measurement, callback);
    window.removeEventListener(TIME_TO_LOG_EVENT, listener);

    expect(callback).toHaveBeenCalledWith(measurement);
    expect(received).toEqual([measurement]);
  });
});

describe('queued mutation shape', () => {
  it('addresses the resource by the id the client minted', async () => {
    const store = createMemoryStore();
    const engine = createBrewEngine({
      store,
      fetchImpl: async () => {
        throw new TypeError('offline');
      },
      baseDelayMs: 5,
    });
    const id = uuidv7();
    await engine.logBrew(record(id));
    await engine.queue.flush();

    const [mutation] = (await engine.queue.pending()) as QueuedMutation[];
    expect(mutation?.method).toBe('PUT');
    expect(mutation?.path).toBe(`/api/v1/brews/${id}`);
    expect(mutation?.type).toBe('brew_session');
  });
});
