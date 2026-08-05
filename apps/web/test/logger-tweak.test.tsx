/**
 * Path B — the tweak card (docs/brew_logger_ux.md §3).
 *
 * The three things this path has to get right, tested here:
 *  1. steppers move the value (and the keyboard never has to appear);
 *  2. the ratio is derived — the locked follower tracks what you changed;
 *  3. `changed_fields` records the experiment and *only* the experiment.
 */
import type { BrewPrefill } from '@brewcult/shared-types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BrewLogger } from '../components/logger/brew-logger';
import {
  deriveWater,
  ratioOf,
  setNumericField,
  setVerdict,
  toggleRatioLock,
  draftFromPrefill,
  type LocalBrewRecord,
} from '../lib/brewing-client';
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
};

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 300, status, json: async () => body } as unknown as Response;
}

async function setup() {
  const store = createMemoryStore();
  await store.set(KEYS.activeBag, COFFEE);
  await store.set(KEYS.prefill(COFFEE.id), PREFILL);

  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/brews/prefill')) return jsonResponse(PREFILL);
    if (init?.method === 'PUT') {
      return jsonResponse({ id: 'x', applied: 'created', updated_at: '2026-08-04T06:00:00.000Z' });
    }
    return jsonResponse({ items: [] });
  });

  const engine = createBrewEngine({ store, fetchImpl, baseDelayMs: 5 });
  const user = userEvent.setup();
  render(<BrewLogger engine={engine} fetchImpl={fetchImpl} />);
  await user.click(await screen.findByRole('button', { name: /^tweak$/i }));
  return { store, engine, user };
}

async function sessions(store: OfflineStore): Promise<LocalBrewRecord[]> {
  return (await store.entries<LocalBrewRecord>(KEYS.sessionPrefix)).map(([, record]) => record);
}

describe('Path B — steppers', () => {
  it('increments and decrements without a keyboard', async () => {
    const { user } = await setup();

    const temperature = screen.getByRole('spinbutton', { name: 'Temperature' });
    expect(temperature).toHaveAttribute('aria-valuenow', '94');

    await user.click(screen.getByRole('button', { name: /increase temperature/i }));
    expect(screen.getByRole('spinbutton', { name: 'Temperature' })).toHaveAttribute(
      'aria-valuenow',
      '95',
    );

    await user.click(screen.getByRole('button', { name: /decrease temperature/i }));
    await user.click(screen.getByRole('button', { name: /decrease temperature/i }));
    expect(screen.getByRole('spinbutton', { name: 'Temperature' })).toHaveAttribute(
      'aria-valuenow',
      '93',
    );
  });

  it('is keyboard operable via the arrow keys', async () => {
    const { user } = await setup();
    const grind = screen.getByRole('spinbutton', { name: 'Grind' });
    grind.focus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('spinbutton', { name: 'Grind' })).toHaveAttribute(
      'aria-valuenow',
      '7',
    );
  });

  it('lets the number itself be typed when a stepper would be slower', async () => {
    const { user } = await setup();

    await user.click(screen.getByRole('spinbutton', { name: 'Dose' }));
    const input = screen.getByRole('textbox', { name: /dose, exact value/i });
    await user.clear(input);
    await user.type(input, '18{Enter}');

    expect(screen.getByRole('spinbutton', { name: 'Dose' })).toHaveAttribute('aria-valuenow', '18');
    // Water followed at the locked 1:16.7.
    expect(screen.getByRole('spinbutton', { name: 'Water' })).toHaveAttribute(
      'aria-valuenow',
      '300',
    );
  });
});

describe('Path B — derived ratio', () => {
  it('moves water when dose changes, at the locked ratio', async () => {
    const { user } = await setup();

    await user.click(screen.getByRole('button', { name: /increase dose/i }));

    expect(screen.getByRole('spinbutton', { name: 'Dose' })).toHaveAttribute(
      'aria-valuenow',
      '15.5',
    );
    expect(screen.getByRole('spinbutton', { name: 'Water' })).toHaveAttribute(
      'aria-valuenow',
      String(deriveWater(15.5, ratioOf(15, 250))),
    );
  });

  it('moves dose instead once the lock is flipped', () => {
    const draft = toggleRatioLock(draftFromPrefill(PREFILL));
    expect(draft.follow).toBe('dose');

    const next = setNumericField(draft, 'water_g', 300);
    expect(next.water_g).toBe(300);
    expect(next.dose_g).toBe(18);
    // The ratio held; only water was touched.
    expect(next.changed).toEqual(['water_g']);
  });

  it('treats editing the follower as a ratio change, not a derivation', () => {
    const draft = draftFromPrefill(PREFILL); // water follows dose
    const next = setNumericField(draft, 'water_g', 300);
    expect(next.dose_g).toBe(15);
    expect(next.ratio).toBeCloseTo(20, 5);
  });
});

describe('Path B — changed_fields', () => {
  it('records only what the user touched, never the derived follower', async () => {
    const { store, user } = await setup();

    await user.click(screen.getByRole('button', { name: /increase dose/i }));
    await user.click(screen.getByRole('button', { name: /^log brew$/i }));
    await screen.findByText(/logged\./i);

    await waitFor(async () => expect(await sessions(store)).toHaveLength(1));
    const [record] = await sessions(store);
    expect(record?.session.changed_fields).toEqual(['dose_g']);
    expect(record?.session.source).toBe('tweak');
    expect(record?.session.params).toMatchObject({ dose_g: 15.5, water_g: 258 });
  });

  it('keeps taste out of changed_fields — it is a result, not a parameter', async () => {
    const { store, user } = await setup();

    await user.click(screen.getByRole('button', { name: /increase grind/i }));
    await user.click(screen.getByRole('button', { name: /^bitter/i }));
    await user.click(screen.getByRole('button', { name: /^log brew$/i }));
    await screen.findByText(/logged\./i);

    await waitFor(async () => expect(await sessions(store)).toHaveLength(1));
    const [record] = await sessions(store);
    expect(record?.session.changed_fields).toEqual(['grind']);
    expect(record?.session.taste?.verdict).toBe('bitter');
  });

  it('one-tap taste sets the verdict and tapping again clears it', () => {
    const draft = draftFromPrefill(PREFILL);
    expect(setVerdict(draft, 'sour').verdict).toBe('sour');
    expect(setVerdict(setVerdict(draft, 'sour'), null).verdict).toBeNull();
    expect(setVerdict(draft, 'sour').changed).toEqual([]);
  });
});

describe('Path B — payback copy', () => {
  it('offers a warm fix after a bitter brew, never blame', async () => {
    const { user } = await setup();

    await user.click(screen.getByRole('button', { name: /^bitter/i }));
    await user.click(screen.getByRole('button', { name: /^log brew$/i }));

    const line = await screen.findByText(/coarser tomorrow/i);
    expect(line.textContent).toMatch(/that happens/i);
    expect(line.textContent).not.toMatch(/wrong|failed|bad/i);
  });
});
