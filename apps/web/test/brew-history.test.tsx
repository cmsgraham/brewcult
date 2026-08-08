/**
 * The brew history (/brew/history).
 *
 * The behaviour worth pinning is not the list — it is the MERGE. A brew lives
 * on the device from the moment it is logged and on the server only once the
 * queue drains, so a history that shows one source is wrong at exactly the
 * moment somebody checks whether their brew saved.
 *
 * Nothing here touches a live server: fetch is a mock and persistence is the
 * in-memory adapter of the same port IndexedDB implements in the browser.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrewHistory } from '../components/logger/brew-history';
import { LocaleProvider } from '../components/locale-provider';
import type { LocalBrewRecord } from '../lib/brewing-client';
import { resetRefreshState } from '../lib/api';
import { createBrewEngine, KEYS } from '../lib/offline/engine';
import { createMemoryStore, type OfflineStore } from '../lib/offline/store';
import { en } from '../messages/en';
import { es } from '../messages/es';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** One row in the shape `GET /v1/brews` really returns, labels included. */
function serverSession(over: Record<string, unknown> = {}) {
  return {
    id: 'srv-1',
    user_id: 'user-1',
    recipe_id: null,
    coffee_product_id: 'coffee-1',
    roast_batch_id: null,
    brewer_model_id: 'v60',
    grinder_model_id: 'ode-2',
    grind: { equipment_model_id: 'ode-2', setting: '6.5', scale_type: 'stepless', category: 'medium' },
    params: { method: 'filter', dose_g: 16.5, water_g: 275, temperature_c: 91, brew_time_s: 165 },
    params_schema_version: 1,
    changed_fields: [],
    source: 'new',
    photo_media_id: null,
    brewed_at: '2026-08-06T15:00:00.000Z',
    created_at: '2026-08-06T15:00:00.000Z',
    updated_at: '2026-08-06T15:00:00.000Z',
    coffee_label: 'La Pastora',
    coffee_slug: 'coope-tarrazu-la-pastora',
    roaster_label: 'Coopetarrazú',
    brewer_label: 'Hario V60',
    ...over,
  };
}

function localRecord(over: Partial<LocalBrewRecord> = {}): LocalBrewRecord {
  return {
    session: {
      id: 'local-1',
      user_id: 'user-1',
      recipe_id: null,
      coffee_product_id: null,
      roast_batch_id: null,
      brewer_model_id: null,
      grinder_model_id: null,
      grind: { equipment_model_id: null, setting: '7.0', scale_type: 'stepless', category: 'medium' },
      params: { method: 'filter', dose_g: 18, water_g: 300, temperature_c: 93, brew_time_s: 180 },
      params_schema_version: 1,
      changed_fields: [],
      source: 'new',
      photo_media_id: null,
      brewed_at: '2026-08-07T08:00:00.000Z',
      created_at: '2026-08-07T08:00:00.000Z',
      updated_at: '2026-08-07T08:00:00.000Z',
    },
    coffee_label: 'Una bolsa sin catalogar',
    brewer_label: null,
    synced: false,
    ...over,
  } as LocalBrewRecord;
}

async function mount(
  store: OfflineStore,
  fetchImpl: ReturnType<typeof vi.fn>,
  locale: 'en' | 'es' = 'en',
) {
  const engine = createBrewEngine({ store, fetchImpl });
  render(
    <LocaleProvider locale={locale}>
      <BrewHistory engine={engine} fetchImpl={fetchImpl} />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  resetRefreshState();
});

describe('brew history', () => {
  it('shows the names behind the ids, not the ids', async () => {
    const store = createMemoryStore();
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [serverSession()], next_cursor: null }));

    await mount(store, fetchImpl);

    expect(await screen.findByText('La Pastora')).toBeInTheDocument();
    // Roaster and brewer share one muted line under the coffee.
    expect(screen.getByText(/Coopetarrazú/)).toBeInTheDocument();
    expect(screen.getByText(/Hario V60/)).toBeInTheDocument();
    // The numbers, with the ratio derived rather than stored.
    expect(screen.getByText(/16\.5g → 275g/)).toBeInTheDocument();
  });

  /**
   * The reason this component merges two sources at all. A brew logged with no
   * signal is on the device and nowhere else; leaving it out of the history is
   * indistinguishable, to the person who logged it, from having lost it.
   */
  it('includes an unsynced local brew and marks it as still on the device', async () => {
    const store = createMemoryStore();
    const record = localRecord();
    await store.set(KEYS.session(record.session.id), record);
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [serverSession()], next_cursor: null }));

    await mount(store, fetchImpl);

    expect(await screen.findByText('Una bolsa sin catalogar')).toBeInTheDocument();
    expect(screen.getByText(en.history.pending)).toBeInTheDocument();
    // And the synced one is still there beside it.
    expect(screen.getByText('La Pastora')).toBeInTheDocument();
  });

  it('does not show a synced brew twice when the server already has it', async () => {
    const store = createMemoryStore();
    // Same id on both sides: one brew, seen from two places.
    const record = localRecord({ synced: true });
    await store.set(KEYS.session(record.session.id), record);
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        items: [serverSession({ id: 'local-1', coffee_label: 'La Pastora' })],
        next_cursor: null,
      }),
    );

    await mount(store, fetchImpl);

    await waitFor(() => expect(screen.getByText('La Pastora')).toBeInTheDocument());
    expect(screen.queryByText(en.history.pending)).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('orders by when the coffee was brewed, not by which source it came from', async () => {
    const store = createMemoryStore();
    // Logged offline YESTERDAY — it must not jump above today's synced brew.
    const older = localRecord({
      session: { ...localRecord().session, id: 'local-old', brewed_at: '2026-08-01T08:00:00.000Z' },
      coffee_label: 'Bolsa vieja',
    });
    await store.set(KEYS.session(older.session.id), older);
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        items: [serverSession({ brewed_at: '2026-08-07T15:00:00.000Z' })],
        next_cursor: null,
      }),
    );

    await mount(store, fetchImpl);

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('La Pastora');
    expect(items[1]).toHaveTextContent('Bolsa vieja');
  });

  /** 401 is "sign in", not "something broke". */
  it('asks an unauthenticated visitor to sign in rather than apologising', async () => {
    const store = createMemoryStore();
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'unauthorized' }, 401));

    await mount(store, fetchImpl);

    expect(await screen.findByText(en.history.signedOutLink)).toBeInTheDocument();
  });

  /**
   * A server that cannot be reached must not hide the brews that ARE here —
   * the offline-first promise is exactly that the device keeps working.
   */
  it('still shows local brews when the server cannot be reached', async () => {
    const store = createMemoryStore();
    const record = localRecord();
    await store.set(KEYS.session(record.session.id), record);
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });

    await mount(store, fetchImpl);

    expect(await screen.findByText('Una bolsa sin catalogar')).toBeInTheDocument();
    expect(screen.getByText(en.history.partial)).toBeInTheDocument();
  });

  it('invites a first brew rather than reporting an empty list', async () => {
    const store = createMemoryStore();
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [], next_cursor: null }));

    await mount(store, fetchImpl);

    expect(await screen.findByText(en.history.empty)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.history.logFirst })).toBeInTheDocument();
  });

  it('pages with the keyset cursor the API returns', async () => {
    const store = createMemoryStore();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ items: [serverSession()], next_cursor: 'cursor-2' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [serverSession({ id: 'srv-2', coffee_label: 'Guji Uraga', brewed_at: '2026-08-05T15:00:00.000Z' })],
          next_cursor: null,
        }),
      );

    await mount(store, fetchImpl);

    await userEvent.click(await screen.findByRole('button', { name: en.history.more }));

    expect(await screen.findByText('Guji Uraga')).toBeInTheDocument();
    expect(String(fetchImpl.mock.calls[1]![0])).toContain('cursor=cursor-2');
  });

  it('renders in Spanish on a Spanish page', async () => {
    const store = createMemoryStore();
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [], next_cursor: null }));

    await mount(store, fetchImpl, 'es');

    expect(await screen.findByText(es.history.empty)).toBeInTheDocument();
  });
});
