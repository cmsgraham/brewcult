/**
 * Catalog module — public DTO types (second_draft §21.2).
 *
 * These are the shapes the HTTP layer returns. They are deliberately flat-ish
 * and slug-addressable: every reference carries `{id, slug, name}` so callers
 * can link to the entity graph without a second round-trip (§5 — "no free text
 * where an entity reference is possible").
 */

export type RoastLevel = 'light' | 'medium-light' | 'medium' | 'medium-dark' | 'dark';
export type IntendedUse = 'filter' | 'espresso' | 'omni';
export type CoffeeStatus = 'active' | 'seasonal' | 'discontinued';
export type LotProcess = 'washed' | 'natural' | 'honey' | 'anaerobic' | 'experimental';
export type EquipmentCategory =
  | 'brewer'
  | 'grinder'
  | 'kettle'
  | 'scale'
  | 'machine'
  | 'accessory';
export type GrindScaleType = 'stepped' | 'stepless' | 'rotational';
export type GrindConversionSource = 'user_confirmed' | 'seeded';

/** Cursor-paginated envelope used by every catalog list endpoint (§22 conventions). */
export interface Page<T> {
  items: T[];
  /** Opaque keyset cursor; null when there is no further page. */
  next_cursor: string | null;
}

export interface RoasterRef {
  id: string;
  slug: string;
  name: string;
}

export interface OriginRef {
  id: string;
  country: string;
  region: string | null;
}

export interface FarmRef {
  id: string;
  name: string;
  story: string | null;
}

/** Provenance — lives on the lot, never on the product (§6.1). */
export interface CoffeeLot {
  id: string;
  process: LotProcess;
  process_detail: string | null;
  varietals: string[];
  altitude_masl: number | null;
  harvest_period: string | null;
  origin: OriginRef | null;
  farm: FarmRef | null;
}

/** List-shaped coffee: enough to render a card, no lot story or batches. */
export interface CoffeeSummary {
  id: string;
  slug: string;
  name: string;
  roast_level: RoastLevel;
  intended_use: IntendedUse;
  tasting_notes: string[];
  status: CoffeeStatus;
  roaster: RoasterRef;
  origin: OriginRef | null;
  process: LotProcess | null;
  created_at: string;
  updated_at: string;
}

/** Freshness lives on the batch (§6.2). */
export interface RoastBatch {
  id: string;
  roast_date: string;
}

export interface CoffeeDetail extends CoffeeSummary {
  lot: CoffeeLot | null;
  roast_batches: RoastBatch[];
}

export interface RoasterSummary {
  id: string;
  slug: string;
  name: string;
  location: string | null;
  verified: boolean;
  coffee_count: number;
  created_at: string;
  updated_at: string;
}

export interface RoasterDetail extends RoasterSummary {
  coffees: CoffeeSummary[];
}

export interface EquipmentBrandRef {
  id: string;
  name: string;
}

export interface EquipmentSummary {
  id: string;
  slug: string;
  name: string;
  category: EquipmentCategory;
  /** Only ever non-null for grinders — enforced by a table CHECK (§6.4). */
  grind_scale_type: GrindScaleType | null;
  brand: EquipmentBrandRef;
  created_at: string;
  updated_at: string;
}

export interface EquipmentDetail extends EquipmentSummary {
  specs: Record<string, unknown>;
}

export interface OriginSummary extends OriginRef {
  description: string | null;
  coffee_count: number;
}

/** One hit from GET /v1/search — discriminated by `type`. */
export interface SearchHit {
  type: 'coffee' | 'roaster' | 'equipment';
  id: string;
  slug: string;
  label: string;
  sublabel: string | null;
  /** ts_rank score; comparable only within one response. */
  score: number;
}

/** One item from GET /v1/autocomplete — the §5 entity-picker payload. */
export interface AutocompleteItem {
  type: 'coffee' | 'roaster' | 'equipment';
  id: string;
  slug: string;
  label: string;
  sublabel: string | null;
}

/**
 * Uncertainty envelope for a grind conversion (§6.4 point 4).
 *
 * A converted setting is NEVER presented as exact — every conversion carries
 * the confidence, how many community data points back the grinder pair, and
 * whether it came from a seeded chart or a confirmed user brew.
 */
export interface GrindUncertainty {
  /** 0..1 as stored on the row. */
  confidence: number;
  /** Number of conversion data points backing this grinder pair. */
  sample_size: number;
  source: GrindConversionSource;
  /** Human-readable confidence band derived from `confidence`. */
  band: 'low' | 'medium' | 'high';
}

export interface GrindModelRef {
  id: string;
  slug: string;
  name: string;
  brand: string;
  grind_scale_type: GrindScaleType | null;
}

export interface GrindConversion {
  id: string;
  from_model: GrindModelRef;
  from_setting: string;
  to_model: GrindModelRef;
  /** Approximate. Always render together with `uncertainty`. */
  to_setting: string;
  uncertainty: GrindUncertainty;
}

export interface GrindConversionResponse {
  items: GrindConversion[];
  /** Always present, always shown next to any converted setting (§6.4). */
  disclaimer: string;
}
