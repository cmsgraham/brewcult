/**
 * Fastify JSON schemas for every catalog input (EF §3.3: "all input validated
 * at the API boundary against schemas").
 *
 * `additionalProperties: false` everywhere — an unknown field is a client bug
 * or an attack, never something to silently ignore. Controlled vocabularies are
 * spelled out as enums so the API rejects what the database CHECK constraints
 * would reject anyway, but with a 400 and a useful message instead of a 500.
 */

export const ROAST_LEVELS = ['light', 'medium-light', 'medium', 'medium-dark', 'dark'] as const;
export const INTENDED_USES = ['filter', 'espresso', 'omni'] as const;
export const COFFEE_STATUSES = ['active', 'seasonal', 'discontinued'] as const;
export const LOT_PROCESSES = ['washed', 'natural', 'honey', 'anaerobic', 'experimental'] as const;
export const EQUIPMENT_CATEGORIES = [
  'brewer',
  'grinder',
  'kettle',
  'scale',
  'machine',
  'accessory',
] as const;
export const GRIND_SCALE_TYPES = ['stepped', 'stepless', 'rotational'] as const;
export const ENTITY_TYPES = ['coffee', 'roaster', 'equipment'] as const;

// Pattern rather than `format: 'uuid'` so validation never depends on which
// format plugins the Ajv instance happens to carry.
const UUID_RE = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const uuid = { type: 'string', pattern: UUID_RE } as const;
const nullableUuid = { type: ['string', 'null'], pattern: UUID_RE } as const;
const slug = { type: 'string', minLength: 1, maxLength: 120, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' };
const limit = { type: 'integer', minimum: 1, maximum: 100, default: 20 };
const cursor = { type: 'string', minLength: 1, maxLength: 512 };

export const slugParams = {
  type: 'object',
  required: ['slug'],
  additionalProperties: false,
  properties: { slug: { type: 'string', minLength: 1, maxLength: 200 } },
};

export const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: uuid },
};

export const coffeeListQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    roaster: { type: 'string', minLength: 1, maxLength: 200 },
    origin: { type: 'string', minLength: 1, maxLength: 200 },
    process: { type: 'string', enum: [...LOT_PROCESSES] },
    roast_level: { type: 'string', enum: [...ROAST_LEVELS] },
    intended_use: { type: 'string', enum: [...INTENDED_USES] },
    status: { type: 'string', enum: [...COFFEE_STATUSES] },
    cursor,
    limit,
  },
};

export const roasterListQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { verified: { type: 'boolean' }, cursor, limit },
};

export const equipmentListQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: { type: 'string', enum: [...EQUIPMENT_CATEGORIES] },
    brand: { type: 'string', minLength: 1, maxLength: 200 },
    cursor,
    limit,
  },
};

export const searchQuery = {
  type: 'object',
  required: ['q'],
  additionalProperties: false,
  properties: {
    q: { type: 'string', minLength: 1, maxLength: 200 },
    // Single type (matches §22's `GET /search?q=&type=`); omit for everything.
    type: { type: 'string', enum: [...ENTITY_TYPES, 'all'] },
    limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
  },
};

export const autocompleteQuery = {
  type: 'object',
  required: ['q'],
  additionalProperties: false,
  properties: {
    q: { type: 'string', minLength: 1, maxLength: 100 },
    /** Comma-separated: `coffee,roaster,equipment`. Defaults to all three. */
    types: { type: 'string', minLength: 1, maxLength: 100 },
    limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
  },
};

export const grindConversionQuery = {
  type: 'object',
  required: ['from_model_id'],
  additionalProperties: false,
  properties: { from_model_id: uuid, to_model_id: uuid },
};

// --- editorial write bodies ------------------------------------------------

export const roasterCreateBody = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    slug,
    location: { type: ['string', 'null'], maxLength: 200 },
    verified: { type: 'boolean' },
  },
};

export const roasterUpdateBody = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    slug,
    location: { type: ['string', 'null'], maxLength: 200 },
    verified: { type: 'boolean' },
  },
};

const tastingNotes = {
  type: 'array',
  maxItems: 24,
  items: { type: 'string', minLength: 1, maxLength: 60 },
};

export const coffeeCreateBody = {
  type: 'object',
  required: ['roaster_id', 'name', 'roast_level', 'intended_use'],
  additionalProperties: false,
  properties: {
    roaster_id: uuid,
    coffee_lot_id: nullableUuid,
    name: { type: 'string', minLength: 1, maxLength: 200 },
    slug,
    roast_level: { type: 'string', enum: [...ROAST_LEVELS] },
    intended_use: { type: 'string', enum: [...INTENDED_USES] },
    tasting_notes: tastingNotes,
    status: { type: 'string', enum: [...COFFEE_STATUSES] },
  },
};

export const coffeeUpdateBody = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    roaster_id: uuid,
    coffee_lot_id: nullableUuid,
    name: { type: 'string', minLength: 1, maxLength: 200 },
    slug,
    roast_level: { type: 'string', enum: [...ROAST_LEVELS] },
    intended_use: { type: 'string', enum: [...INTENDED_USES] },
    tasting_notes: tastingNotes,
    status: { type: 'string', enum: [...COFFEE_STATUSES] },
  },
};

export const equipmentCreateBody = {
  type: 'object',
  required: ['brand_id', 'category', 'name'],
  additionalProperties: false,
  properties: {
    brand_id: uuid,
    category: { type: 'string', enum: [...EQUIPMENT_CATEGORIES] },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    slug,
    specs: { type: 'object' },
    grind_scale_type: { type: ['string', 'null'], enum: [...GRIND_SCALE_TYPES, null] },
  },
};

export const equipmentUpdateBody = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    brand_id: uuid,
    category: { type: 'string', enum: [...EQUIPMENT_CATEGORIES] },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    slug,
    specs: { type: 'object' },
    grind_scale_type: { type: ['string', 'null'], enum: [...GRIND_SCALE_TYPES, null] },
  },
};
