/**
 * Brewing module unit suite (EF §1.4 — the base of the pyramid).
 *
 * Pure domain logic only: the taste→extraction mapping, the changed_fields diff,
 * params canonicalisation and cursor encoding. The DB-backed behaviour lives in
 * brewing.test.ts.
 */

import { describe, expect, it } from 'vitest';

import { diffRecipes, diffSessions } from '../src/modules/brewing/diff.js';
import {
  assertParamsMatchMethod,
  bodyHash,
  canonicalJson,
  normaliseGrind,
  normaliseParams,
} from '../src/modules/brewing/params.js';
import { diagnoseTaste, isRatedGood } from '../src/modules/brewing/taste.js';
import { decodeCursor, encodeCursor, paginate } from '../src/modules/brewing/cursor.js';
import type { BrewParams, GrindSetting } from '../src/modules/brewing/types.js';

const grind = (over: Partial<GrindSetting> = {}): GrindSetting => ({
  equipment_model_id: 'ode',
  setting: '6.5',
  scale_type: 'stepped',
  category: 'medium_fine',
  ...over,
});

const filterRecipe = (over: Record<string, unknown> = {}) => ({
  title: 'Chelbesa',
  coffee_product_id: 'coffee-1',
  coffee_style: null,
  method: 'filter',
  brewer_model_id: 'v60',
  grind: grind() as unknown as Record<string, unknown>,
  params: { method: 'filter', dose_g: 15, water_g: 250, ratio: 16.67, temperature_c: 94 },
  ...over,
});

describe('taste → extraction diagnosis (§6.7)', () => {
  it('maps every verdict exactly as the domain specifies', () => {
    expect(diagnoseTaste({ verdict: 'bitter' })).toBe('over_extracted');
    expect(diagnoseTaste({ verdict: 'sour' })).toBe('under_extracted');
    expect(diagnoseTaste({ verdict: 'weak' })).toBe('under_extracted');
    expect(diagnoseTaste({ verdict: 'good' })).toBe('balanced');
  });

  it('never guesses when there is no verdict', () => {
    expect(diagnoseTaste(null)).toBe('unclear');
    expect(diagnoseTaste(undefined)).toBe('unclear');
  });

  it('confirms "good" only on an explicit positive signal (risk #9)', () => {
    expect(isRatedGood({ verdict: 'good' }, null)).toBe(true);
    expect(isRatedGood(null, 5)).toBe(true);
    expect(isRatedGood(null, 4)).toBe(true);
    expect(isRatedGood(null, 3)).toBe(false);
    expect(isRatedGood(null, null)).toBe(false);
    // An explicit bad verdict overrules generous stars.
    expect(isRatedGood({ verdict: 'bitter' }, 5)).toBe(false);
    expect(isRatedGood({ verdict: 'weak' }, 5)).toBe(false);
  });
});

describe('params canonicalisation (§6.3)', () => {
  it('derives the ratio and never trusts the client value', () => {
    const params = normaliseParams({
      method: 'filter',
      dose_g: 15,
      water_g: 250,
      ratio: 3,
    } as BrewParams);
    expect(params).toMatchObject({ ratio: 16.67 });
  });

  it('derives the espresso ratio from yield over dose', () => {
    const params = normaliseParams({
      method: 'espresso',
      dose_in_g: 18,
      yield_out_g: 36,
    } as BrewParams);
    expect(params).toMatchObject({ ratio: 2 });
  });

  it('rejects a zero dose rather than dividing by it', () => {
    expect(() =>
      normaliseParams({ method: 'filter', dose_g: 0, water_g: 250 } as BrewParams),
    ).toThrow();
  });

  it('refuses an espresso params object on a filter method and vice versa', () => {
    expect(() =>
      assertParamsMatchMethod('filter', {
        method: 'espresso',
        dose_in_g: 18,
        yield_out_g: 36,
      } as BrewParams),
    ).toThrow(/espresso/);
    expect(() =>
      assertParamsMatchMethod('espresso', {
        method: 'filter',
        dose_g: 15,
        water_g: 250,
      } as BrewParams),
    ).toThrow();
    expect(() =>
      assertParamsMatchMethod('immersion', {
        method: 'immersion',
        dose_g: 15,
        water_g: 250,
      } as BrewParams),
    ).not.toThrow();
  });

  it('fills every grind field so a bare number is impossible (§6.4)', () => {
    expect(normaliseGrind({ category: 'coarse' } as GrindSetting)).toEqual({
      equipment_model_id: null,
      setting: null,
      scale_type: null,
      category: 'coarse',
    });
  });

  it('hashes by content, not by key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(bodyHash({ a: 1, b: [1, 2] })).toBe(bodyHash({ b: [1, 2], a: 1 }));
    // Arrays are ordered data (a pour schedule) and must NOT be normalised away.
    expect(bodyHash({ b: [1, 2] })).not.toBe(bodyHash({ b: [2, 1] }));
  });
});

describe('changed_fields diff (§6.6)', () => {
  it('reports sorted dotted leaf paths', () => {
    const parent = filterRecipe();
    const child = filterRecipe({
      grind: grind({ equipment_model_id: 'comandante', setting: '22', scale_type: 'rotational' }),
      params: { method: 'filter', dose_g: 16, water_g: 250, ratio: 15.63, temperature_c: 94 },
    });
    expect(diffRecipes(parent, child)).toEqual([
      'grind.equipment_model_id',
      'grind.scale_type',
      'grind.setting',
      'params.dose_g',
    ]);
  });

  it('never reports the derived ratio', () => {
    const parent = filterRecipe();
    const child = filterRecipe({
      params: { method: 'filter', dose_g: 15, water_g: 300, ratio: 20 },
    });
    expect(diffRecipes(parent, child)).toEqual(['params.temperature_c', 'params.water_g']);
  });

  it('is empty for an identical copy', () => {
    expect(diffRecipes(filterRecipe(), filterRecipe())).toEqual([]);
  });

  it('treats null and an omitted field as the same absence', () => {
    const parent = filterRecipe({ coffee_style: null });
    const child = filterRecipe({ coffee_style: undefined });
    expect(diffRecipes(parent, child as never)).toEqual([]);
  });

  it('compares pour schedules structurally', () => {
    const withPours = filterRecipe({
      params: { method: 'filter', dose_g: 15, water_g: 250, pours: [{ at_s: 0, to_g: 45 }] },
    });
    const changed = filterRecipe({
      params: { method: 'filter', dose_g: 15, water_g: 250, pours: [{ at_s: 0, to_g: 50 }] },
    });
    expect(diffRecipes(withPours, changed)).toEqual(['params.pours']);
  });

  it('diffs sessions across grind, params, water and equipment', () => {
    const base = {
      recipe_id: null,
      coffee_product_id: 'c1',
      roast_batch_id: null,
      brewer_model_id: 'v60',
      grinder_model_id: 'ode',
      rating: 4,
      grind: grind() as unknown as Record<string, unknown>,
      params: { method: 'filter', dose_g: 15, water_g: 250 } as Record<string, unknown>,
      water: { preset: 'tap' } as Record<string, unknown> | null,
    };
    const next = {
      ...base,
      rating: 5,
      grind: grind({ setting: '6.0' }) as unknown as Record<string, unknown>,
      water: { preset: 'filtered' } as Record<string, unknown>,
    };
    expect(diffSessions(base, next)).toEqual(['grind.setting', 'rating', 'water.preset']);
  });
});

describe('keyset cursors', () => {
  it('round-trips and stays opaque', () => {
    const key = { ts: '2026-08-04T09:00:00.000Z', id: '01890000-0000-7000-8000-000000000001' };
    const encoded = encodeCursor(key);
    expect(encoded).not.toContain('2026');
    expect(decodeCursor(encoded)).toEqual(key);
  });

  it('rejects anything tampered with, as a 400 rather than a 500', () => {
    expect(() => decodeCursor('not-base64-json')).toThrow(/cursor/i);
    expect(() => decodeCursor(Buffer.from('["x","y"]').toString('base64url'))).toThrow();
    expect(() =>
      decodeCursor(Buffer.from('["2026-08-04T09:00:00Z","not-a-uuid"]').toString('base64url')),
    ).toThrow();
  });

  it('trims an over-fetched page and derives the next cursor from the last kept row', () => {
    const rows = [
      { id: '01890000-0000-7000-8000-000000000001', at: '2026-08-04T09:00:00.000Z' },
      { id: '01890000-0000-7000-8000-000000000002', at: '2026-08-04T08:00:00.000Z' },
      { id: '01890000-0000-7000-8000-000000000003', at: '2026-08-04T07:00:00.000Z' },
    ];
    const page = paginate(rows, 2, (r) => r.at);
    expect(page.items).toHaveLength(2);
    expect(page.has_more).toBe(true);
    expect(decodeCursor(page.next_cursor!)).toEqual({
      ts: '2026-08-04T08:00:00.000Z',
      id: rows[1]!.id,
    });

    const last = paginate(rows.slice(0, 2), 2, (r) => r.at);
    expect(last.next_cursor).toBeNull();
    expect(last.has_more).toBe(false);
  });
});
