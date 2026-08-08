/**
 * The logger's local-first engine (brew_logger_ux §5, EF §2.2).
 *
 * Everything the screen needs is read from and written to the device first;
 * the network is a background reconciler, never something the user waits on:
 *
 *   tap → session written locally → rendered as logged → queued → PUT → synced
 *
 * The engine owns *storage and sync*. It knows nothing about React, so the
 * whole offline story is testable without rendering anything.
 */
import type { BrewPrefill, BrewSession } from '@brewcult/shared-types';
import { ApiError, isApiError, type FetchLike } from '../api';
import {
  brewingApi,
  normalizeBrewList,
  type BrewDraft,
  type BrewSuggestion,
  type BrewUpsertBody,
  type CoffeeRef,
  type LocalBrewRecord,
} from '../brewing-client';
import { SyncQueue, type QueueListener, type QueuedMutation } from './queue';
import { createOfflineStore, type OfflineStore } from './store';

export const KEYS = {
  activeBag: 'brew:active-bag',
  recentCoffees: 'brew:recent-coffees',
  prefill: (coffeeId: string | null) => `brew:prefill:${coffeeId ?? 'default'}`,
  draft: (coffeeId: string | null) => `brew:draft:${coffeeId ?? 'default'}`,
  session: (id: string) => `brew:session:${id}`,
  sessionPrefix: 'brew:session:',
  suggestion: (coffeeId: string | null) => `brew:suggestion:${coffeeId ?? 'default'}`,
} as const;

export const MAX_RECENT_COFFEES = 8;

/** Kept small on purpose: this is a working set, not a synced archive. */
export const MAX_LOCAL_SESSIONS = 60;

export interface BrewEngineOptions {
  store?: OfflineStore;
  fetchImpl?: FetchLike;
  now?: () => number;
  /** Queue tuning — tests pass tiny delays. */
  baseDelayMs?: number;
  maxAttempts?: number;
}

/** ApiError(0) is the wrapper's "we never reached the server" signal. */
function isTransportError(error: unknown): boolean {
  if (error instanceof ApiError) {
    // 401/403 after a failed refresh means "sign in again", not "retry harder":
    // pause the drain and keep the brew queued rather than burning attempts.
    return error.status === 0 || error.status === 401 || error.status === 403;
  }
  return true;
}

function isPermanentError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 408 || error.status === 429) return false;
  if (error.status === 401 || error.status === 403) return false;
  // A 404 means the endpoint isn't deployed yet (Lane H in flight) — that is
  // temporary infrastructure, not a rejected brew. Keep it queued.
  if (error.status === 404) return false;
  return error.status >= 400 && error.status < 500;
}

export class BrewEngine {
  readonly store: OfflineStore;
  readonly queue: SyncQueue;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly now: () => number;

  constructor(options: BrewEngineOptions = {}) {
    this.store = options.store ?? createOfflineStore();
    this.fetchImpl = options.fetchImpl;
    this.now = options.now ?? (() => Date.now());

    this.queue = new SyncQueue({
      store: this.store,
      now: this.now,
      ...(options.baseDelayMs !== undefined ? { baseDelayMs: options.baseDelayMs } : {}),
      ...(options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {}),
      isTransportError,
      isPermanentError,
      send: async (mutation: QueuedMutation) => {
        const options = this.fetchImpl ? { fetchImpl: this.fetchImpl } : {};

        // Dispatch on the method. This used to call `upsert` unconditionally,
        // which was fine while PUT was the only thing ever queued — a queued
        // DELETE would have been sent as a PUT and resurrected the brew it was
        // supposed to remove.
        if (mutation.method === 'DELETE') {
          try {
            await brewingApi.remove(mutation.id, options);
          } catch (error) {
            // Already gone is the outcome we wanted. Anything else re-throws
            // and the queue's own retry policy decides.
            if (!(isApiError(error) && error.status === 404)) throw error;
          }
          return;
        }

        await brewingApi.upsert(mutation.body as BrewUpsertBody, options);
        await this.markSynced(mutation.id);
      },
    });
  }

  start(): void {
    this.queue.start();
  }

  stop(): void {
    this.queue.stop();
  }

  onSyncStateChange(listener: QueueListener): () => void {
    return this.queue.subscribe(listener);
  }

  /* --- active bag + recents (§8 decision 2) ------------------------ */

  activeBag(): Promise<CoffeeRef | undefined> {
    return this.store.get<CoffeeRef>(KEYS.activeBag);
  }

  async setActiveBag(coffee: CoffeeRef | null): Promise<void> {
    if (coffee === null) {
      await this.store.delete(KEYS.activeBag);
      return;
    }
    await this.store.set(KEYS.activeBag, coffee);
    await this.rememberCoffee(coffee);
  }

  async recentCoffees(): Promise<CoffeeRef[]> {
    return (await this.store.get<CoffeeRef[]>(KEYS.recentCoffees)) ?? [];
  }

  async rememberCoffee(coffee: CoffeeRef): Promise<void> {
    const existing = await this.recentCoffees();
    const identity = (ref: CoffeeRef) => ref.id ?? ref.label;
    const next = [coffee, ...existing.filter((ref) => identity(ref) !== identity(coffee))].slice(
      0,
      MAX_RECENT_COFFEES,
    );
    await this.store.set(KEYS.recentCoffees, next);
  }

  /* --- prefill: cache first, network second ------------------------ */

  cachedPrefill(coffeeId: string | null): Promise<BrewPrefill | undefined> {
    return this.store.get<BrewPrefill>(KEYS.prefill(coffeeId));
  }

  /**
   * Refresh the prefill in the background. Resolves `null` on any failure —
   * a missing or slow endpoint must never be the reason the logger is empty.
   */
  async refreshPrefill(coffeeId: string | null): Promise<BrewPrefill | null> {
    try {
      const prefill = await brewingApi.prefill(coffeeId, {
        ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
      });
      if (!prefill || typeof prefill !== 'object') return null;
      await this.store.set(KEYS.prefill(coffeeId), prefill);
      return prefill;
    } catch {
      return null;
    }
  }

  /* --- drafts: interruption-proof (§5) ----------------------------- */

  loadDraft(coffeeId: string | null): Promise<BrewDraft | undefined> {
    return this.store.get<BrewDraft>(KEYS.draft(coffeeId));
  }

  saveDraft(coffeeId: string | null, draft: BrewDraft): Promise<void> {
    return this.store.set(KEYS.draft(coffeeId), draft);
  }

  clearDraft(coffeeId: string | null): Promise<void> {
    return this.store.delete(KEYS.draft(coffeeId));
  }

  /* --- sessions ---------------------------------------------------- */

  async localSessions(coffeeId?: string | null): Promise<LocalBrewRecord[]> {
    const entries = await this.store.entries<LocalBrewRecord>(KEYS.sessionPrefix);
    return entries
      .map(([, record]) => record)
      .filter(
        (record) =>
          coffeeId === undefined || (record.session.coffee_product_id ?? null) === (coffeeId ?? null),
      )
      .sort((a, b) => (a.session.brewed_at < b.session.brewed_at ? -1 : 1));
  }

  /**
   * The heart of it: persist locally, render as logged, sync after.
   * Resolves as soon as the device has the brew — the PUT is not awaited.
   */
  async logBrew(record: LocalBrewRecord): Promise<LocalBrewRecord> {
    const stored: LocalBrewRecord = { ...record, synced: false };
    await this.store.set(KEYS.session(record.session.id), stored);
    await this.enqueueUpsert(record.session);
    await this.trimLocalSessions();
    // Fire-and-forget: a slow network must not slow the "Logged" state down.
    void this.queue.flush();
    return stored;
  }

  /**
   * Amend an already-logged session (the "rate it" tap). Same id, so the queue
   * replaces the pending entry and the server sees one idempotent PUT.
   */
  async amendBrew(session: BrewUpsertBody): Promise<void> {
    const key = KEYS.session(session.id);
    const existing = await this.store.get<LocalBrewRecord>(key);
    await this.store.set(key, {
      coffee_label: existing?.coffee_label ?? null,
      brewer_label: existing?.brewer_label ?? null,
      ...existing,
      session,
      synced: false,
    });
    await this.enqueueUpsert(session);
    void this.queue.flush();
  }

  private enqueueUpsert(session: BrewUpsertBody): Promise<unknown> {
    return this.queue.enqueue({
      id: session.id,
      type: 'brew_session',
      method: 'PUT',
      path: `/api/v1/brews/${session.id}`,
      body: session,
      queued_at: new Date(this.now()).toISOString(),
    });
  }

  /**
   * Forget a brew — on this device now, on the server when there is signal.
   *
   * ── ORDER MATTERS, AND THIS IS THE WHOLE FUNCTION ───────────────────────
   * Dropping the queued PUT comes FIRST. A brew logged minutes ago may still
   * be waiting to sync; delete the local record without removing that entry
   * and the drain happily replays the upsert, recreating on the server exactly
   * the brew somebody just deleted. It would come back on the next sync, which
   * reads as the app ignoring you.
   *
   * ── WHEN THE SERVER NEEDS TELLING AT ALL ────────────────────────────────
   * Only when it could plausibly know about the brew. A record still marked
   * unsynced never reached it — `markSynced` is awaited immediately after the
   * PUT resolves, so `synced === false` with an entry still queued means the
   * upsert has not succeeded — and queueing a DELETE for a row the server has
   * never seen would just retry a 404. A row absent from the device entirely
   * came from the server list, so that one always gets a DELETE.
   *
   * The DELETE is QUEUED rather than sent, so this works with no signal for
   * the same reason logging does.
   */
  async deleteBrew(id: string): Promise<void> {
    const record = await this.store.get<LocalBrewRecord>(KEYS.session(id));
    await this.queue.remove('brew_session', id);
    await this.store.delete(KEYS.session(id));

    const neverReachedServer = record !== undefined && !record.synced;
    if (neverReachedServer) return;

    await this.queue.enqueue({
      id,
      type: 'brew_session',
      method: 'DELETE',
      path: `/api/v1/brews/${id}`,
      body: null,
      queued_at: new Date(this.now()).toISOString(),
    });
    void this.queue.flush();
  }

  private async markSynced(id: string): Promise<void> {
    const key = KEYS.session(id);
    const record = await this.store.get<LocalBrewRecord>(key);
    if (record) await this.store.set(key, { ...record, synced: true });
  }

  private async trimLocalSessions(): Promise<void> {
    const entries = await this.store.entries<LocalBrewRecord>(KEYS.sessionPrefix);
    if (entries.length <= MAX_LOCAL_SESSIONS) return;
    const sorted = entries.sort(([, a], [, b]) =>
      a.session.brewed_at < b.session.brewed_at ? -1 : 1,
    );
    for (const [key, record] of sorted.slice(0, entries.length - MAX_LOCAL_SESSIONS)) {
      // Never drop something the server has not acknowledged.
      if (record.synced) await this.store.delete(key);
    }
  }

  /**
   * Pull this bag's history so the payback line is right on a fresh device.
   * Degrades to whatever is already local.
   */
  async hydrateSessions(coffeeId: string | null): Promise<LocalBrewRecord[]> {
    try {
      const raw = await brewingApi.list(
        { coffee_product_id: coffeeId, limit: 20 },
        { ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}) },
      );
      const { items } = normalizeBrewList(raw);
      for (const session of items) {
        if (!session?.id) continue;
        const key = KEYS.session(session.id);
        if (await this.store.get<LocalBrewRecord>(key)) continue;
        await this.store.set(key, {
          session: session as BrewSession as BrewUpsertBody,
          coffee_label: null,
          brewer_label: null,
          synced: true,
        });
      }
    } catch {
      /* offline or not deployed yet — local history is still the truth */
    }
    return this.localSessions(coffeeId);
  }

  /* --- the "try 0.5 coarser tomorrow?" carry-over (§6) -------------- */

  pendingSuggestion(coffeeId: string | null): Promise<BrewSuggestion | undefined> {
    return this.store.get<BrewSuggestion>(KEYS.suggestion(coffeeId));
  }

  setPendingSuggestion(coffeeId: string | null, suggestion: BrewSuggestion | null): Promise<void> {
    return suggestion === null
      ? this.store.delete(KEYS.suggestion(coffeeId))
      : this.store.set(KEYS.suggestion(coffeeId), suggestion);
  }
}

export function createBrewEngine(options: BrewEngineOptions = {}): BrewEngine {
  return new BrewEngine(options);
}
