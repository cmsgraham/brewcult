/**
 * Path A (repeat), Path C (new coffee) and the instrumentation behind the
 * 15-second bar (docs/brew_logger_ux.md §3, §7).
 *
 * Nothing here touches a live server: fetch is a mock and persistence is the
 * in-memory adapter of the offline store, which is the same port IndexedDB
 * implements in the browser.
 */
import type { BrewPrefill } from '@brewcult/shared-types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrewLogger } from '../components/logger/brew-logger';
import type { LocalBrewRecord, TimeToLogMeasurement } from '../lib/brewing-client';
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
  puts: Array<{ url: string; body: unknown }>;
}

async function harness(overrides: { seedBag?: boolean } = {}): Promise<Harness> {
  const store = createMemoryStore();
  if (overrides.seedBag !== false) {
    await store.set(KEYS.activeBag, COFFEE);
    await store.set(KEYS.recentCoffees, [COFFEE]);
    await store.set(KEYS.prefill(COFFEE.id), PREFILL);
  }

  const puts: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/brews/prefill')) return jsonResponse(PREFILL);
    if (url.includes('/autocomplete')) {
      // The REAL envelope: `{query, items}` with `sublabel`. This stub used to
      // say `{results:[…{subtitle}]}` — the client's belief, not the server's —
      // so it passed while the picker was returning nothing in production. A
      // stub copied from the caller can only ever confirm the caller.
      // apps/api/test/catalog.test.ts pins this shape on the other side.
      return jsonResponse({
        query: 'kenya',
        items: [
          {
            id: 'coffee-2',
            type: 'coffee',
            slug: 'kenya-kiamabara',
            label: 'Kenya Kiamabara',
            sublabel: 'Nomad Roasters',
          },
        ],
      });
    }
    if (init?.method === 'PUT') {
      puts.push({ url, body: JSON.parse(String(init.body)) });
      return jsonResponse({ id: 'x', applied: 'created', updated_at: '2026-08-04T06:00:00.000Z' });
    }
    return jsonResponse({ items: [] });
  });

  return { store, fetchImpl, puts };
}

async function loggedSessions(store: OfflineStore): Promise<LocalBrewRecord[]> {
  const entries = await store.entries<LocalBrewRecord>(KEYS.sessionPrefix);
  return entries.map(([, record]) => record);
}

describe('Path A — brew this again', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs a session with source "repeat" in a single interaction', async () => {
    const { store, fetchImpl } = await harness();
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

    // The card is interactive from local cache, before any network response.
    const repeat = await screen.findByRole('button', { name: /brew this again/i });
    expect(screen.getByText(/15g → 250g/)).toBeInTheDocument();

    await user.click(repeat);

    await screen.findByText(/logged\./i);

    const sessions = await loggedSessions(store);
    expect(sessions).toHaveLength(1);
    const [record] = sessions;
    expect(record?.session.source).toBe('repeat');
    expect(record?.session.changed_fields).toEqual([]);
    expect(record?.session.params).toMatchObject({ method: 'filter', dose_g: 15, water_g: 250 });
    expect(record?.session.coffee_product_id).toBe(COFFEE.id);
  });

  it('emits a time-to-log measurement counting exactly one interaction', async () => {
    const { store, fetchImpl } = await harness();
    const engine = createBrewEngine({ store, fetchImpl, baseDelayMs: 5 });
    const measurements: TimeToLogMeasurement[] = [];
    const user = userEvent.setup();

    render(
      <BrewLogger
        engine={engine}
        fetchImpl={fetchImpl}
        onMeasure={(measurement) => measurements.push(measurement)}
      />,
    );

    await user.click(await screen.findByRole('button', { name: /brew this again/i }));
    await screen.findByText(/logged\./i);

    expect(measurements).toHaveLength(1);
    const [measurement] = measurements;
    expect(measurement?.path).toBe('A');
    expect(measurement?.source).toBe('repeat');
    expect(measurement?.interactions).toBe(1);
    expect(measurement?.ms).toBeGreaterThanOrEqual(0);
    expect(measurement?.session_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  it('syncs the log with an idempotent PUT to the id it minted', async () => {
    const { store, fetchImpl, puts } = await harness();
    const engine = createBrewEngine({ store, fetchImpl, baseDelayMs: 5 });
    const user = userEvent.setup();

    render(<BrewLogger engine={engine} fetchImpl={fetchImpl} />);
    await user.click(await screen.findByRole('button', { name: /brew this again/i }));
    await screen.findByText(/logged\./i);

    await waitFor(() => expect(puts).toHaveLength(1));
    const [put] = puts;
    const sessions = await loggedSessions(store);
    expect(put?.url).toContain(`/api/v1/brews/${sessions[0]?.session.id}`);
  });

  it('offers the rating afterwards without blocking, and one tap sets the verdict', async () => {
    const { store, fetchImpl } = await harness();
    const engine = createBrewEngine({ store, fetchImpl, baseDelayMs: 5 });
    const user = userEvent.setup();

    render(<BrewLogger engine={engine} fetchImpl={fetchImpl} />);
    await user.click(await screen.findByRole('button', { name: /brew this again/i }));
    await screen.findByText(/logged\./i);

    // The brew is already logged — rating is an offer, not a step.
    expect((await loggedSessions(store))[0]?.session.taste).toBeUndefined();

    await user.click(screen.getByRole('button', { name: /^good/i }));

    await waitFor(async () => {
      const sessions = await loggedSessions(store);
      expect(sessions[0]?.session.taste?.verdict).toBe('good');
    });
    // Same session, not a second one.
    expect(await loggedSessions(store)).toHaveLength(1);
  });

  it('shows a payback line and never a streak', async () => {
    const { store, fetchImpl } = await harness();
    const engine = createBrewEngine({ store, fetchImpl, baseDelayMs: 5 });
    const user = userEvent.setup();

    render(<BrewLogger engine={engine} fetchImpl={fetchImpl} />);
    await user.click(await screen.findByRole('button', { name: /brew this again/i }));

    expect(await screen.findByText(/1st brew of this bag/i)).toBeInTheDocument();
    expect(screen.queryByText(/streak/i)).toBeNull();
  });
});

describe('Path C — new coffee', () => {
  it('searches the catalogue and switches the card to the chosen coffee', async () => {
    const { store, fetchImpl } = await harness();
    const engine = createBrewEngine({ store, fetchImpl, baseDelayMs: 5 });
    const user = userEvent.setup();

    render(<BrewLogger engine={engine} fetchImpl={fetchImpl} />);
    await user.click(await screen.findByRole('button', { name: /switch bag/i }));
    await user.click(screen.getByRole('button', { name: /brewing a new coffee/i }));

    await user.type(screen.getByLabelText(/which coffee/i), 'kiam');
    const option = await screen.findByRole('button', { name: /kenya kiamabara/i });
    await user.click(option);

    await user.click(await screen.findByRole('button', { name: /^log brew$/i }));
    await screen.findByText(/logged\./i);

    const sessions = await store.entries<LocalBrewRecord>(KEYS.sessionPrefix);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.[1].session.source).toBe('new');
    expect(sessions[0]?.[1].session.coffee_product_id).toBe('coffee-2');
    expect(sessions[0]?.[1].session.changed_fields).toEqual(['coffee_product_id']);
  });

  it('never dead-ends: a three-field quick-add still logs a brew', async () => {
    const { store, fetchImpl } = await harness();
    const engine = createBrewEngine({ store, fetchImpl, baseDelayMs: 5 });
    const user = userEvent.setup();

    render(<BrewLogger engine={engine} fetchImpl={fetchImpl} />);
    await user.click(await screen.findByRole('button', { name: /switch bag/i }));
    await user.click(screen.getByRole('button', { name: /brewing a new coffee/i }));
    await user.click(screen.getByRole('button', { name: /add it in three fields/i }));

    await user.type(screen.getByLabelText(/roaster/i), 'Local Roastery');
    await user.type(screen.getByLabelText(/coffee name/i), 'Mystery Bag');
    await user.click(screen.getByRole('button', { name: /use this coffee/i }));

    await user.click(await screen.findByRole('button', { name: /^log brew$/i }));
    await screen.findByText(/logged\./i);

    const [entry] = await store.entries<LocalBrewRecord>(KEYS.sessionPrefix);
    expect(entry?.[1].session.coffee_product_id).toBeNull();
    expect(entry?.[1].session.provisional_coffee).toMatchObject({
      roaster: 'Local Roastery',
      name: 'Mystery Bag',
    });
    expect(entry?.[1].coffee_label).toContain('Mystery Bag');
  });
});
