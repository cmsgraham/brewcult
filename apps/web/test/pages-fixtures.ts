/**
 * Shared fixtures + a tiny fetch router for the public catalog page tests.
 *
 * Payloads are copied from the **live dev API** (`curl http://localhost:4000/v1/…`
 * against the seeded database), not invented, so drift between these tests and
 * the real contract surfaces as a test failure rather than as a blank page in
 * production. Anything the API does not serve yet (recipes) is marked as such
 * and follows `@brewcult/shared-types#Recipe`.
 *
 * Plain `.ts`, not `*.test.ts`: vitest's `include` would otherwise treat it as
 * a suite with no tests. `vi.mock` calls live in the individual test files —
 * they are hoisted per-file and cannot be shared from a helper.
 */
import { vi } from 'vitest';

/** Thrown by each file's `notFound()` stub so tests can assert the 404 path. */
export class NotFoundError extends Error {
  constructor() {
    super('NEXT_NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export interface RouteResponse {
  status?: number;
  body?: unknown;
}

/**
 * Install a `fetch` stub that answers by longest-matching path prefix.
 * Anything unmatched 404s — an unexpected request is a bug in the page, and a
 * permissive default would hide it.
 */
export function mockApi(routes: Record<string, RouteResponse>): void {
  const entries = Object.entries(routes).sort((a, b) => b[0].length - a[0].length);

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = String(input);
      const match = entries.find(([path]) => url.startsWith(path));
      const response: RouteResponse = match
        ? match[1]
        : { status: 404, body: { error: 'not_found', message: 'Route not found' } };
      const status = response.status ?? 200;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(response.body ?? {}),
      } as unknown as Response);
    }),
  );
}

/** `{ items, next_cursor }` — the catalog list envelope. */
export const page = (items: unknown[], nextCursor: string | null = null) => ({
  items,
  next_cursor: nextCursor,
});

/* ------------------------------------------------------------------ *
 * Catalog fixtures (live-API shapes, snake_case)
 * ------------------------------------------------------------------ */

export const ROASTER_REF = {
  id: '7b286475-d255-4842-80b0-835333103c65',
  slug: 'cascara-roasting-co',
  name: 'Cascara Roasting Co.',
};

export const ORIGIN_REF = {
  id: '1fab9e1c-3206-480b-bc36-3315d59813e6',
  country: 'Ethiopia',
  region: 'Yirgacheffe',
};

export const COFFEE_SUMMARY = {
  id: '2b2bf338-ccc3-401d-a06a-0c1f41d108a9',
  slug: 'cascara-ethiopia-chelbesa-washed',
  name: 'Ethiopia Chelbesa, Washed',
  roast_level: 'light',
  intended_use: 'filter',
  tasting_notes: ['jasmine', 'lemon', 'black tea'],
  status: 'active',
  roaster: ROASTER_REF,
  origin: ORIGIN_REF,
  process: 'washed',
  created_at: '2026-08-05T00:00:04.761Z',
  updated_at: '2026-08-05T00:00:04.761Z',
};

export const COFFEE_DETAIL = {
  ...COFFEE_SUMMARY,
  lot: {
    id: '3e061dab-426f-45b7-99ac-45c882052e28',
    process: 'washed',
    process_detail: null,
    varietals: ['74110', '74112', 'Heirloom'],
    altitude_masl: 2100,
    harvest_period: '2025/26 main crop',
    origin: ORIGIN_REF,
    farm: {
      id: 'fc4aefab-edf6-46ca-920c-ac431133bf77',
      name: 'Chelbesa Washing Station',
      story:
        'Smallholder cherry from the Gedeb woreda, processed at a community washing station at ~2,100 masl.',
    },
  },
  roast_batches: [{ id: 'batch-1', roast_date: '2026-07-20T00:00:00.000Z' }],
};

/** The degraded case the API really does return: `lot: null`, no batches. */
export const COFFEE_DETAIL_NO_LOT = {
  ...COFFEE_SUMMARY,
  id: 'f5054042-87f0-474f-aeda-3e95af524e90',
  slug: 'meridian-yirgacheffe-natural',
  name: 'Yirgacheffe Natural',
  lot: null,
  roast_batches: [],
};

export const ROASTER_DETAIL = {
  id: 'f9d8d9d8-538a-4bcc-b0ec-f36c5ceacb15',
  slug: 'meridian-coffee-roasters',
  name: 'Meridian Coffee Roasters',
  location: 'Melbourne, Australia',
  verified: false,
  coffee_count: 2,
  created_at: '2026-08-05T00:00:04.761Z',
  updated_at: '2026-08-05T00:00:04.761Z',
  coffees: [
    COFFEE_SUMMARY,
    {
      ...COFFEE_SUMMARY,
      id: 'a43a56f5-298c-47ee-96f4-d230ec5f5a32',
      slug: 'meridian-boquete-caturra-lot-12',
      name: 'Boquete Caturra Lot 12',
      status: 'discontinued',
      origin: { id: 'origin-panama', country: 'Panama', region: 'Boquete' },
    },
  ],
};

export const GRINDER_DETAIL = {
  id: 'f2d13b0b-a6c1-4ff8-a7ab-6b6d4e024fbb',
  slug: 'mahlkonig-x54',
  name: 'X54 Allround',
  category: 'grinder',
  grind_scale_type: 'stepped',
  brand: { id: '395d7af7-c93b-4562-8893-6b0ce163e223', name: 'Mahlkönig' },
  created_at: '2026-08-05T00:00:04.761Z',
  updated_at: '2026-08-05T00:00:04.761Z',
  specs: {
    burr: 'flat 54mm',
    drive: 'electric',
    timer: 'digital',
    settings: 'stepped dial, espresso to filter',
  },
};

export const BREWER_DETAIL = {
  id: 'e80fb1b1-fcf7-4a61-93bf-45b20616413d',
  slug: 'chemex-6-cup',
  name: 'Classic 6-Cup',
  category: 'brewer',
  grind_scale_type: null,
  brand: { id: '1876568c-04b3-4d25-9d9c-0490e0dc3082', name: 'Chemex' },
  created_at: '2026-08-05T00:00:04.761Z',
  updated_at: '2026-08-05T00:00:04.761Z',
  specs: {},
};

export const GRIND_CONVERSIONS = {
  items: [
    {
      id: 'conv-1',
      from_model: {
        id: GRINDER_DETAIL.id,
        slug: 'mahlkonig-x54',
        name: 'X54 Allround',
        brand: 'Mahlkönig',
        grind_scale_type: 'stepped',
      },
      from_setting: '4.5',
      to_model: {
        id: 'comandante-c40',
        slug: 'comandante-c40',
        name: 'C40 MK4',
        brand: 'Comandante',
        grind_scale_type: 'rotational',
      },
      to_setting: '2.6',
      uncertainty: {
        confidence: 0.62,
        sample_size: 37,
        source: 'user_confirmed',
        band: 'medium',
      },
    },
  ],
  disclaimer:
    'Converted grind settings are approximate starting points derived from community data. Dial in by taste — burr alignment, wear and unit-to-unit variance all move the target.',
};

/** What the live API returns today for a grinder with no recorded pairs. */
export const GRIND_CONVERSIONS_EMPTY = {
  items: [],
  disclaimer: GRIND_CONVERSIONS.disclaimer,
};

export const EQUIPMENT_BRANDS = {
  items: [
    { id: '1876568c-04b3-4d25-9d9c-0490e0dc3082', name: 'Chemex' },
    { id: '395d7af7-c93b-4562-8893-6b0ce163e223', name: 'Mahlkönig' },
  ],
};

export const ORIGINS = {
  items: [
    { ...ORIGIN_REF, description: 'High-altitude birthplace-of-coffee terroir.', coffee_count: 3 },
    {
      id: 'origin-kenya',
      country: 'Kenya',
      region: 'Nyeri',
      description: 'Blackcurrant-driven washed lots.',
      coffee_count: 2,
    },
  ],
};

/* ------------------------------------------------------------------ *
 * Recipe fixtures (@brewcult/shared-types#Recipe + expanded entity refs)
 * ------------------------------------------------------------------ */

export const FILTER_RECIPE = {
  id: '0198f0c1-1111-7000-8000-000000000001',
  title: 'Chelbesa on the V60 — 1:16, gentle',
  method: 'filter',
  is_official: false,
  created_at: '2026-07-01T08:00:00.000Z',
  updated_at: '2026-07-01T08:00:00.000Z',
  author: { id: 'user-1', handle: 'anna', display_name: 'Anna R.' },
  coffee: { ...COFFEE_SUMMARY, roaster: ROASTER_REF },
  brewer: { id: 'hario-v60-02-id', slug: 'hario-v60-02', name: 'V60 Size 02' },
  grinder: { id: GRINDER_DETAIL.id, slug: 'mahlkonig-x54', name: 'X54 Allround' },
  grind: {
    equipment_model_id: GRINDER_DETAIL.id,
    setting: '4.5',
    scale_type: 'stepped',
    category: 'medium_fine',
  },
  params: {
    method: 'filter',
    dose_g: 18,
    water_g: 300,
    ratio: 16.7,
    temperature_c: 94,
    brew_time_s: 195,
    filter_type: 'Hario tabbed',
    pours: [
      { at_s: 0, to_g: 50, note: 'Bloom — swirl gently.' },
      { at_s: 45, to_g: 180 },
      { at_s: 90, to_g: 300, note: 'Finish in a slow spiral.' },
    ],
  },
  parent_recipe_id: null,
  changed_fields: [],
};

/** Espresso + fork lineage — the two branches the filter recipe does not cover. */
export const FORKED_ESPRESSO_RECIPE = {
  id: '0198f0c1-2222-7000-8000-000000000002',
  title: 'Daybreak espresso — shorter and sweeter',
  method: 'espresso',
  is_official: false,
  created_at: '2026-07-14T08:00:00.000Z',
  updated_at: '2026-07-14T08:00:00.000Z',
  author: { id: 'user-2', handle: 'sam', display_name: null },
  coffee: null,
  brewer: null,
  grinder: null,
  grind: { equipment_model_id: null, setting: null, scale_type: null, category: 'fine' },
  params: {
    method: 'espresso',
    dose_in_g: 18,
    yield_out_g: 36,
    shot_time_s: 28,
    temperature_c: 93,
    puck_prep: ['wdt', 'level_tamp'],
  },
  parent_recipe: {
    id: '0198f0c1-1111-7000-8000-000000000009',
    title: 'Daybreak espresso — house shot',
    author: { handle: 'anna', display_name: 'Anna R.' },
  },
  changed_fields: ['yield_out_g', 'shot_time_s'],
};
