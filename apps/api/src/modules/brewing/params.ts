/**
 * Params canonicalisation (REC-01/§6.3) and payload hashing (EF §2.2).
 *
 * Two jobs, both of which have to happen before anything is compared or stored:
 *
 *  1. `ratio` is DERIVED, never user-entered (§6.3). Clients round-trip whole
 *     params objects — the repeat path literally re-sends what prefill gave it —
 *     so a client-supplied ratio is accepted at the boundary and then
 *     overwritten here. It is never trusted.
 *  2. Idempotent PUT needs "is this the same body?" to be exact and cheap. JSON
 *     key order is not stable across clients, so a canonical (recursively
 *     key-sorted) serialisation is hashed instead of the raw request body.
 */

import { createHash } from 'node:crypto';
import { badRequest } from '../../lib/errors.js';
import type { BrewParams, GrindSetting } from './types.js';

/** Ratio is stored to 2dp: 250/15 = 16.67, which is what the UI shows. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Returns params with the derived `ratio` recomputed from the entered values.
 * The input object is never mutated.
 */
export function normaliseParams(params: BrewParams): BrewParams {
  if (params.method === 'espresso') {
    const { dose_in_g, yield_out_g } = params;
    if (dose_in_g <= 0) throw badRequest('dose_in_g must be greater than zero.');
    return { ...params, ratio: round2(yield_out_g / dose_in_g) };
  }
  const { dose_g, water_g } = params;
  if (dose_g <= 0) throw badRequest('dose_g must be greater than zero.');
  return { ...params, ratio: round2(water_g / dose_g) };
}

/**
 * Enforces the discriminated union across the two places the method appears
 * (§6.3: filter and espresso are structurally different schemas, and one
 * generic schema produces junk data). The JSON Schema layer already refuses a
 * body whose params do not match EITHER shape; this refuses the subtler bug of
 * a well-formed espresso params object attached to a filter recipe.
 */
export function assertParamsMatchMethod(method: string, params: BrewParams): void {
  if (params.method !== method) {
    throw badRequest(
      `Params are for a '${params.method}' brew but the recipe method is '${method}'. ` +
        'Filter/immersion and espresso are separate schemas (§6.3).',
      { expected: method, received: params.method },
    );
  }
}

/** Grind category is mandatory even when a device-specific setting exists (§6.4). */
export function normaliseGrind(grind: GrindSetting): GrindSetting {
  return {
    equipment_model_id: grind.equipment_model_id ?? null,
    setting: grind.setting ?? null,
    scale_type: grind.scale_type ?? null,
    category: grind.category,
  };
}

/**
 * Deterministic JSON: object keys sorted recursively, `undefined` dropped.
 * Arrays keep their order (a pour schedule is ordered data).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, canonicalise(v)]));
  }
  return value;
}

/**
 * Content hash of a write payload. Two PUTs of the same logical body produce the
 * same hash regardless of key order, which is what makes the second one a
 * genuine noop rather than an update that bumps `updated_at` and re-syncs the
 * row to every other device.
 */
export function bodyHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
