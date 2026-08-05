/**
 * Fastify JSON schemas for every brewing input (EF §3.3, §1.3: "JSONB fields
 * carry a schema_version and are validated against a versioned JSON Schema at
 * the API boundary. Unversioned JSONB is schema drift on a timer.").
 *
 * The centrepiece is `brewParams`: a real discriminated union over `method`, so
 * an espresso payload is structurally impossible on a filter brew and vice
 * versa (§6.3 — "one generic schema produces junk data"). Both branches are
 * `additionalProperties: false`, which is what makes the `oneOf` decisive: a
 * filter body cannot accidentally satisfy the espresso branch by carrying extra
 * keys. The route layer then cross-checks `params.method` against the recipe's
 * own `method` column (see params.ts), because a well-formed espresso params
 * object attached to a filter recipe passes this schema but is still nonsense.
 *
 * Mirrors `packages/shared-types/src/brewing.ts`. Keep the two in step; the
 * contract is the source of truth and this file is its runtime enforcement.
 *
 * NOTE ON `additionalProperties: false`: Fastify's shared Ajv instance runs with
 * its default `removeAdditional: true`, so an unknown property is STRIPPED
 * rather than rejected with a 400. That is an app-wide choice (apps/api/src/
 * app.ts constructs the Fastify instance), not one this module can make, and the
 * invariant that matters survives it: an unknown field can never reach the
 * database, and no espresso field can ride along on a filter row. If the repo
 * later prefers loud rejection, set `ajv.customOptions.removeAdditional: false`
 * once at the app level — every schema here is already written for it.
 */

const UUID_RE = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

const uuid = { type: 'string', pattern: UUID_RE } as const;
const nullableUuid = { type: ['string', 'null'], pattern: UUID_RE } as const;
const timestamp = { type: 'string', minLength: 10, maxLength: 40 } as const;
const cursor = { type: 'string', minLength: 1, maxLength: 512 } as const;
const limit = { type: 'integer', minimum: 1, maximum: 100, default: 20 } as const;

export const GRIND_CATEGORIES = [
  'extra_fine',
  'fine',
  'medium_fine',
  'medium',
  'medium_coarse',
  'coarse',
] as const;
export const GRIND_SCALE_TYPES = ['stepped', 'stepless', 'rotational'] as const;
export const BREW_METHODS = ['filter', 'immersion', 'espresso'] as const;
export const FILTER_METHODS = ['filter', 'immersion'] as const;
export const RECIPE_VISIBILITIES = ['private', 'unlisted', 'public'] as const;
export const BREW_SOURCES = ['repeat', 'tweak', 'new', 'import'] as const;
export const TASTE_VERDICT_VALUES = ['bitter', 'sour', 'weak', 'good'] as const;
export const WATER_PRESETS = ['tap', 'filtered', 'bottled', 'mineral_packet', 'custom'] as const;
export const SYNC_RESOURCE_TYPES = ['brew_session', 'recipe'] as const;

// --- grind (§6.4) ----------------------------------------------------------
// `category` is required, always. A bare number is meaningless without the
// grinder it was read off, so the universal fallback vocabulary is the one
// field the API refuses to do without (REC-02: "bare-number grind impossible").

export const grindSetting = {
  type: 'object',
  required: ['category'],
  additionalProperties: false,
  properties: {
    equipment_model_id: nullableUuid,
    setting: { type: ['string', 'null'], maxLength: 40 },
    scale_type: { type: ['string', 'null'], enum: [...GRIND_SCALE_TYPES, null] },
    category: { type: 'string', enum: [...GRIND_CATEGORIES] },
  },
} as const;

// --- params (§6.3): two schemas, discriminated on `method` -----------------

const pourStep = {
  type: 'object',
  required: ['at_s', 'to_g'],
  additionalProperties: false,
  properties: {
    at_s: { type: 'number', minimum: 0, maximum: 3600 },
    to_g: { type: 'number', minimum: 0, maximum: 5000 },
    note: { type: 'string', maxLength: 200 },
  },
} as const;

const pressurePoint = {
  type: 'object',
  required: ['at_s'],
  additionalProperties: false,
  properties: {
    at_s: { type: 'number', minimum: 0, maximum: 600 },
    bar: { type: 'number', minimum: 0, maximum: 20 },
    flow_ml_s: { type: 'number', minimum: 0, maximum: 50 },
  },
} as const;

export const filterParams = {
  type: 'object',
  required: ['method', 'dose_g', 'water_g'],
  additionalProperties: false,
  properties: {
    method: { type: 'string', enum: [...FILTER_METHODS] },
    dose_g: { type: 'number', exclusiveMinimum: 0, maximum: 500 },
    water_g: { type: 'number', exclusiveMinimum: 0, maximum: 5000 },
    // Derived (water/dose). Accepted so clients can round-trip a prefill
    // payload unchanged; ALWAYS recomputed server-side, never trusted.
    ratio: { type: 'number', minimum: 0, maximum: 1000 },
    temperature_c: { type: 'number', minimum: 0, maximum: 110 },
    pours: { type: 'array', maxItems: 20, items: pourStep },
    brew_time_s: { type: 'number', minimum: 0, maximum: 7200 },
    filter_type: { type: 'string', maxLength: 80 },
    agitation: { type: 'string', maxLength: 200 },
  },
} as const;

export const espressoParams = {
  type: 'object',
  required: ['method', 'dose_in_g', 'yield_out_g'],
  additionalProperties: false,
  properties: {
    method: { type: 'string', const: 'espresso' },
    dose_in_g: { type: 'number', exclusiveMinimum: 0, maximum: 100 },
    yield_out_g: { type: 'number', exclusiveMinimum: 0, maximum: 500 },
    ratio: { type: 'number', minimum: 0, maximum: 100 },
    shot_time_s: { type: 'number', minimum: 0, maximum: 600 },
    temperature_c: { type: 'number', minimum: 0, maximum: 110 },
    pre_infusion_s: { type: 'number', minimum: 0, maximum: 120 },
    pressure_profile: { type: 'array', maxItems: 60, items: pressurePoint },
    basket_size_g: { type: 'number', minimum: 0, maximum: 100 },
    puck_prep: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 40 } },
  },
} as const;

export const brewParams = { oneOf: [filterParams, espressoParams] } as const;

// --- session-only payloads --------------------------------------------------

export const waterProfile = {
  type: 'object',
  required: ['preset'],
  additionalProperties: false,
  properties: {
    preset: { type: 'string', enum: [...WATER_PRESETS] },
    label: { type: 'string', maxLength: 80 },
    ppm: { type: 'number', minimum: 0, maximum: 2000 },
  },
} as const;

export const tasteResult = {
  type: 'object',
  required: ['verdict'],
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: [...TASTE_VERDICT_VALUES] },
    intensity: { type: 'integer', minimum: 1, maximum: 5 },
    flavor_tags: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 40 } },
    notes: { type: 'string', maxLength: 2000 },
  },
} as const;

export const measurements = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tds_pct: { type: 'number', minimum: 0, maximum: 10 },
    extraction_yield_pct: { type: 'number', minimum: 0, maximum: 40 },
  },
} as const;

const changedFields = {
  type: 'array',
  maxItems: 40,
  items: { type: 'string', minLength: 1, maxLength: 60 },
} as const;

// --- params ---------------------------------------------------------------

export const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: uuid },
} as const;

// --- recipes ---------------------------------------------------------------

const recipeCore = {
  title: { type: 'string', minLength: 1, maxLength: 200 },
  coffee_product_id: nullableUuid,
  coffee_style: { type: ['string', 'null'], maxLength: 120 },
  method: { type: 'string', enum: [...BREW_METHODS] },
  brewer_model_id: nullableUuid,
  grind: grindSetting,
  params: brewParams,
  visibility: { type: 'string', enum: [...RECIPE_VISIBILITIES] },
} as const;

export const recipeCreateBody = {
  type: 'object',
  required: ['title', 'method', 'grind', 'params'],
  additionalProperties: false,
  properties: {
    // Optional on POST (server mints one); required on PUT, where it is the
    // client-generated UUIDv7 that makes the upsert idempotent (EF §2.2).
    id: uuid,
    ...recipeCore,
  },
} as const;

export const recipePutBody = {
  type: 'object',
  required: ['title', 'method', 'grind', 'params'],
  additionalProperties: false,
  properties: {
    ...recipeCore,
    /**
     * The `version` the client last saw. Omit and the write is unconditional;
     * send a stale one and the server produces a CONFLICT COPY rather than
     * overwriting an edit it has not seen (EF §2.2, REC-07).
     */
    base_version: { type: 'integer', minimum: 1 },
  },
} as const;

export const recipePatchBody = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: { ...recipeCore, base_version: { type: 'integer', minimum: 1 } },
} as const;

export const recipeForkBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    /** Client-minted id for the fork, so forking works offline too. */
    id: uuid,
    title: { type: 'string', minLength: 1, maxLength: 200 },
    coffee_product_id: nullableUuid,
    coffee_style: { type: ['string', 'null'], maxLength: 120 },
    brewer_model_id: nullableUuid,
    grind: grindSetting,
    params: brewParams,
    visibility: { type: 'string', enum: [...RECIPE_VISIBILITIES] },
  },
} as const;

export const recipeListQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    /** `me` for the caller's own library, or a user id for a public profile. */
    author: { type: 'string', maxLength: 64 },
    coffee_product_id: uuid,
    method: { type: 'string', enum: [...BREW_METHODS] },
    visibility: { type: 'string', enum: [...RECIPE_VISIBILITIES] },
    is_official: { type: 'boolean' },
    parent_recipe_id: uuid,
    cursor,
    limit,
  },
} as const;

export const recipeReviewBody = {
  type: 'object',
  required: ['rating'],
  additionalProperties: false,
  properties: {
    rating: { type: 'integer', minimum: 1, maximum: 5 },
    body: { type: ['string', 'null'], maxLength: 4000 },
  },
} as const;

// --- brew sessions ----------------------------------------------------------

export const brewPutBody = {
  type: 'object',
  required: ['grind', 'params', 'source'],
  additionalProperties: false,
  properties: {
    /**
     * Optional echo of the path id. The offline queue PUTs the whole local
     * record, which carries its own id; accepting it lets the server CHECK that
     * the two agree instead of silently writing to whichever one the router
     * happened to parse. `user_id` is deliberately NOT accepted — ownership
     * always comes from the authenticated actor, never from the payload.
     */
    id: uuid,
    recipe_id: nullableUuid,
    coffee_product_id: nullableUuid,
    roast_batch_id: nullableUuid,
    brewer_model_id: nullableUuid,
    grinder_model_id: nullableUuid,
    grind: grindSetting,
    params: brewParams,
    water: waterProfile,
    taste: tasteResult,
    measurements,
    rating: { type: 'integer', minimum: 1, maximum: 5 },
    /** Omit and the server diffs against your previous brew of this coffee. */
    changed_fields: changedFields,
    source: { type: 'string', enum: [...BREW_SOURCES] },
    photo_media_id: nullableUuid,
    brewed_at: timestamp,
    /**
     * The client's view of when this row last changed. Used for last-write-wins
     * (EF §2.2): an older payload never clobbers a newer server row.
     */
    updated_at: timestamp,
  },
} as const;

export const brewListQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    coffee_product_id: uuid,
    recipe_id: uuid,
    /** Inclusive ISO-8601 bounds on `brewed_at`. */
    from: timestamp,
    to: timestamp,
    cursor,
    limit,
  },
} as const;

export const brewPrefillQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    coffee_product_id: uuid,
    method: { type: 'string', enum: [...BREW_METHODS] },
  },
} as const;

// --- sync (BREW-05) ---------------------------------------------------------

export const syncChangesQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    /** Opaque cursor from the previous pull; omit for a full download. */
    since: cursor,
    /** Comma-separated: `brew_session,recipe`. Defaults to both. */
    types: { type: 'string', minLength: 1, maxLength: 64 },
    limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
  },
} as const;

// --- grind conversion suggestion (§6.4, GC-03) -----------------------------

export const grindSuggestQuery = {
  type: 'object',
  required: ['from_model_id', 'to_model_id', 'category'],
  additionalProperties: false,
  properties: {
    from_model_id: uuid,
    from_setting: { type: 'string', maxLength: 40 },
    to_model_id: uuid,
    /** Mandatory: the answer must be usable even with zero data points. */
    category: { type: 'string', enum: [...GRIND_CATEGORIES] },
  },
} as const;
