/**
 * The logger's optional photo (docs/brew_logger_ux.md §4, §5).
 *
 * §4: *"Photo — optional, and never blocks the log."* §1 puts a 15-second median
 * on time-to-log. So the assertion this file exists for is the third one below:
 * **a photo that fails to upload must not cost the user their brew.** Everything
 * else here is scaffolding around that one guarantee.
 *
 * As elsewhere in the logger's tests, nothing touches a server: fetch is a mock
 * and persistence is the in-memory adapter of the same offline store port that
 * IndexedDB implements in the browser.
 */
import type { BrewPrefill } from '@brewcult/shared-types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrewLogger } from '../components/logger/brew-logger';
import { resetRefreshState } from '../lib/api';
import type { LocalBrewRecord, TimeToLogMeasurement } from '../lib/brewing-client';
import { PENDING_PHOTO_PREFIX, type PendingPhoto } from '../lib/media-client';
import { createBrewEngine, KEYS } from '../lib/offline/engine';
import { createMemoryStore, type OfflineStore } from '../lib/offline/store';

const COFFEE = { id: 'coffee-1', label: 'Ethiopia Chelbesa' };

const PREFILL: BrewPrefill = {
  coffee_product_id: COFFEE.id,
  recipe_id: null,
  brewer_model_id: 'v60',
  grinder_model_id: 'ode-2',
  grind: { equipment_model_id: 'ode-2', setting: '6.5', scale_type: 'stepless', category: 'medium' },
  params: { method: 'filter', dose_g: 15, water_g: 250, temperature_c: 94, brew_time_s: 165 },
  basis: 'last_session',
  last_session_id: 'session-0',
};

const ASSET = {
  id: 'media-1',
  url: 'https://media.brewcult.test/brew.jpg',
  thumbnail_url: null,
  width: 1200,
  height: 900,
  mime_type: 'image/jpeg',
};

type MediaMode = 'ok' | 'rejected' | 'offline';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

interface Harness {
  store: OfflineStore;
  fetchImpl: ReturnType<typeof vi.fn>;
  puts: Array<{ url: string; body: Record<string, unknown> }>;
  mediaAttempts: () => number;
}

async function harness(mode: MediaMode): Promise<Harness> {
  const store = createMemoryStore();
  await store.set(KEYS.activeBag, COFFEE);
  await store.set(KEYS.recentCoffees, [COFFEE]);
  await store.set(KEYS.prefill(COFFEE.id), PREFILL);

  const puts: Array<{ url: string; body: Record<string, unknown> }> = [];
  let attempts = 0;

  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/v1/media?')) {
      attempts += 1;
      // A dead socket is what `apiFetch` turns into ApiError(0, network_error).
      if (mode === 'offline') throw new TypeError('Failed to fetch');
      if (mode === 'rejected') {
        return jsonResponse({ error: 'file_too_large', message: '' }, 413);
      }
      return jsonResponse(ASSET, 201);
    }
    if (url.includes('/brews/prefill')) return jsonResponse(PREFILL);
    if (init?.method === 'PUT') {
      puts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return jsonResponse({ id: 'x', applied: 'updated', updated_at: '2026-08-04T06:00:00.000Z' });
    }
    return jsonResponse({ items: [] });
  });

  return { store, fetchImpl, puts, mediaAttempts: () => attempts };
}

async function sessions(store: OfflineStore): Promise<LocalBrewRecord[]> {
  const entries = await store.entries<LocalBrewRecord>(KEYS.sessionPrefix);
  return entries.map(([, record]) => record);
}

async function parked(store: OfflineStore): Promise<PendingPhoto[]> {
  const entries = await store.entries<PendingPhoto>(PENDING_PHOTO_PREFIX);
  return entries.map(([, value]) => value);
}

function photoFile(): File {
  return new File(['jpeg-ish-bytes'], 'pour.jpg', { type: 'image/jpeg' });
}

/** The input lives inside a closed <details>; go straight at it. */
function choosePhoto(label: RegExp | string): void {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [photoFile()] } });
}

/**
 * The post-log payback line — a unique marker for "the brew is on the device".
 * `/logged\./` is not: the photo's own status copy contains the word too.
 */
async function awaitLogged(): Promise<void> {
  await screen.findByText(/brew of this bag/i);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRefreshState();
});

describe('Path A stays one interaction', () => {
  it('never offers a photo before the log on the repeat card', async () => {
    const { store, fetchImpl } = await harness('ok');
    const engine = createBrewEngine({ store, fetchImpl, baseDelayMs: 5 });

    render(<BrewLogger engine={engine} fetchImpl={fetchImpl} registerServiceWorkerInBrowser={false} />);
    await screen.findByRole('button', { name: /brew this again/i });

    // §3: one primary button, ~2 seconds. A photo prompt here would be a tax.
    expect(screen.queryByLabelText(/photo of this brew/i)).toBeNull();
    expect(screen.queryByText(/add a photo/i)).toBeNull();
  });

  it('still logs in exactly one interaction', async () => {
    const { store, fetchImpl } = await harness('ok');
    const engine = createBrewEngine({ store, fetchImpl, baseDelayMs: 5 });
    const measurements: TimeToLogMeasurement[] = [];
    const user = userEvent.setup();

    render(
      <BrewLogger
        engine={engine}
        fetchImpl={fetchImpl}
        onMeasure={(measurement) => measurements.push(measurement)}
        registerServiceWorkerInBrowser={false}
      />,
    );

    await user.click(await screen.findByRole('button', { name: /brew this again/i }));
    await awaitLogged();

    expect(measurements).toHaveLength(1);
    expect(measurements[0]?.path).toBe('A');
    expect(measurements[0]?.interactions).toBe(1);
    expect(await sessions(store)).toHaveLength(1);
  });
});

describe('a failed photo never costs the brew', () => {
  it('logs the brew when the upload is rejected outright', async () => {
    const { store, fetchImpl, puts } = await harness('rejected');
    const engine = createBrewEngine({ store, fetchImpl, baseDelayMs: 5 });
    const user = userEvent.setup();

    render(<BrewLogger engine={engine} fetchImpl={fetchImpl} registerServiceWorkerInBrowser={false} />);
    await user.click(await screen.findByRole('button', { name: /tweak/i }));

    choosePhoto('Photo of this brew');

    // The rejection has surfaced, and the primary action is untouched by it.
    expect(await screen.findByRole('alert')).toHaveTextContent(/5 MB/);

    const log = screen.getByRole('button', { name: /^log brew$/i });
    expect(log).not.toBeDisabled();
    await user.click(log);

    await awaitLogged();

    const logged = await sessions(store);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.session.photo_media_id ?? null).toBeNull();

    // The brew still syncs, and nothing was parked for a retry that cannot work.
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(await parked(store)).toHaveLength(0);
  });

  it('logs the brew and parks the photo when there is no signal', async () => {
    const { store, fetchImpl } = await harness('offline');
    const engine = createBrewEngine({ store, fetchImpl, baseDelayMs: 5 });
    const user = userEvent.setup();

    render(<BrewLogger engine={engine} fetchImpl={fetchImpl} registerServiceWorkerInBrowser={false} />);
    await user.click(await screen.findByRole('button', { name: /tweak/i }));

    choosePhoto('Photo of this brew');
    await user.click(await screen.findByRole('button', { name: /^log brew$/i }));
    await awaitLogged();

    const logged = await sessions(store);
    expect(logged).toHaveLength(1);

    // The photo is on the device, keyed to the session it belongs to.
    await waitFor(async () => {
      const pending = await parked(store);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.session_id).toBe(logged[0]?.session.id);
    });
  });

  it('does not wait for a slow upload before reporting the log', async () => {
    const { store, fetchImpl } = await harness('ok');
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchImpl.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/v1/media?')) {
        await slow;
        return jsonResponse(ASSET, 201);
      }
      if (url.includes('/brews/prefill')) return jsonResponse(PREFILL);
      if (init?.method === 'PUT') return jsonResponse({ id: 'x', applied: 'updated' });
      return jsonResponse({ items: [] });
    });

    const engine = createBrewEngine({ store, fetchImpl, baseDelayMs: 5 });
    const user = userEvent.setup();

    render(<BrewLogger engine={engine} fetchImpl={fetchImpl} registerServiceWorkerInBrowser={false} />);
    await user.click(await screen.findByRole('button', { name: /tweak/i }));

    choosePhoto('Photo of this brew');
    await user.click(await screen.findByRole('button', { name: /^log brew$/i }));

    // The upload is still hanging, and the brew is already logged.
    await awaitLogged();
    expect(await sessions(store)).toHaveLength(1);

    release();
    await waitFor(async () => {
      const [record] = await sessions(store);
      expect(record?.session.photo_media_id).toBe('media-1');
    });
  });
});

describe('the photo catches up with the brew', () => {
  it('attaches a photo that uploaded before the log', async () => {
    const { store, fetchImpl } = await harness('ok');
    const engine = createBrewEngine({ store, fetchImpl, baseDelayMs: 5 });
    const user = userEvent.setup();

    render(<BrewLogger engine={engine} fetchImpl={fetchImpl} registerServiceWorkerInBrowser={false} />);
    await user.click(await screen.findByRole('button', { name: /tweak/i }));

    choosePhoto('Photo of this brew');
    await screen.findByText(/photo saved with this brew/i);

    await user.click(screen.getByRole('button', { name: /^log brew$/i }));
    await awaitLogged();

    await waitFor(async () => {
      const [record] = await sessions(store);
      expect(record?.session.photo_media_id).toBe('media-1');
    });
  });

  it('lets someone log first and attach after — including from Path A', async () => {
    const { store, fetchImpl } = await harness('ok');
    const engine = createBrewEngine({ store, fetchImpl, baseDelayMs: 5 });
    const user = userEvent.setup();

    render(<BrewLogger engine={engine} fetchImpl={fetchImpl} registerServiceWorkerInBrowser={false} />);
    await user.click(await screen.findByRole('button', { name: /brew this again/i }));
    await awaitLogged();

    // The offer appears only now, where it costs the log nothing.
    choosePhoto('Add a photo of this brew');

    await waitFor(async () => {
      const [record] = await sessions(store);
      expect(record?.session.photo_media_id).toBe('media-1');
    });
    expect(await sessions(store)).toHaveLength(1);
  });

  it('keeps the photo when the brew is rated afterwards', async () => {
    const { store, fetchImpl } = await harness('ok');
    const engine = createBrewEngine({ store, fetchImpl, baseDelayMs: 5 });
    const user = userEvent.setup();

    render(<BrewLogger engine={engine} fetchImpl={fetchImpl} registerServiceWorkerInBrowser={false} />);
    await user.click(await screen.findByRole('button', { name: /brew this again/i }));
    await awaitLogged();

    choosePhoto('Add a photo of this brew');
    await waitFor(async () => {
      const [record] = await sessions(store);
      expect(record?.session.photo_media_id).toBe('media-1');
    });

    await user.click(screen.getByRole('button', { name: /^good/i }));

    await waitFor(async () => {
      const [record] = await sessions(store);
      expect(record?.session.taste?.verdict).toBe('good');
      expect(record?.session.photo_media_id).toBe('media-1');
    });
  });
});
