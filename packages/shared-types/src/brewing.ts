/**
 * Brewing domain contract — shared by the API (brewing module) and the web
 * logger so both speak one shape. Derived from docs/second_draft.md §6.3
 * (two recipe schemas), §6.4 (grind), §6.7 (taste) and docs/brew_logger_ux.md.
 *
 * Persisted recipe/session params are versioned JSONB validated at the API
 * boundary (EF §1.3): bump PARAMS_SCHEMA_VERSION whenever a shape changes and
 * keep readers tolerant of older versions.
 */

/** Current params shape. This package is types-only (no build step), so each
 *  app declares its own const from this literal type rather than importing a
 *  runtime value. */
export type ParamsSchemaVersion = 1;

// --- Grind (§6.4) ----------------------------------------------------------

/** Universal fallback vocabulary — every recipe carries one, even when a
 *  device-specific setting exists, because settings do not transfer. */
export type GrindCategory =
  | 'extra_fine'
  | 'fine'
  | 'medium_fine'
  | 'medium'
  | 'medium_coarse'
  | 'coarse';

export type GrindScaleType = 'stepped' | 'stepless' | 'rotational';

export interface GrindSetting {
  /** Equipment model the setting belongs to. A bare number is meaningless
   *  without it — see §6.4. Null when the user has no grinder recorded. */
  equipment_model_id: string | null;
  /** Raw as the user reads it off the device: "18", "6.5", "2.6" (2 rotations
   *  + 6 clicks). Kept as text because scales are not uniformly numeric. */
  setting: string | null;
  scale_type: GrindScaleType | null;
  /** Mandatory. The only value that survives a change of grinder. */
  category: GrindCategory;
}

// --- Recipe parameters (§6.3): two schemas, discriminated ------------------

export type BrewMethod = 'filter' | 'immersion' | 'espresso';

export interface PourStep {
  /** Seconds from brew start. The first step is the bloom; it is not a
   *  special field, just the first pour. */
  at_s: number;
  /** Cumulative target scale weight in grams at this step. */
  to_g: number;
  note?: string;
}

export interface FilterParams {
  method: 'filter' | 'immersion';
  dose_g: number;
  water_g: number;
  /** Derived (water/dose); stored for query convenience, never user-entered. */
  ratio?: number;
  temperature_c?: number;
  /** Optional. When absent, the logger recorded total water only. */
  pours?: PourStep[];
  brew_time_s?: number;
  filter_type?: string;
  agitation?: string;
}

export interface PressurePoint {
  at_s: number;
  bar?: number;
  flow_ml_s?: number;
}

export interface EspressoParams {
  method: 'espresso';
  dose_in_g: number;
  yield_out_g: number;
  /** Derived (yield/dose). */
  ratio?: number;
  shot_time_s?: number;
  temperature_c?: number;
  pre_infusion_s?: number;
  pressure_profile?: PressurePoint[];
  basket_size_g?: number;
  puck_prep?: string[];
}

export type BrewParams = FilterParams | EspressoParams;

/** Optional power-user measurements. Never required, never on the fast path. */
export interface Measurements {
  tds_pct?: number;
  extraction_yield_pct?: number;
}

export type WaterPreset = 'tap' | 'filtered' | 'bottled' | 'mineral_packet' | 'custom';

export interface WaterProfile {
  preset: WaterPreset;
  label?: string;
  ppm?: number;
}

// --- Taste (§6.7): structured, one tap, mapped to extraction ---------------

/** Deliberately tiny. Prose is never required; the flavour-wheel tags below
 *  are for enthusiasts who want them. */
export type TasteVerdict = 'bitter' | 'sour' | 'weak' | 'good';

export interface TasteResult {
  verdict: TasteVerdict;
  /** 1–5, optional. Absent means "just the verdict". */
  intensity?: number;
  /** Controlled vocabulary (SCA-wheel derived) so the data stays comparable. */
  flavor_tags?: string[];
  notes?: string;
}

/**
 * What the diagnosis engine infers from a taste verdict (§6.7 / §7.1).
 * The mapping itself (bitter -> over_extracted, sour|weak -> under_extracted)
 * is server-authoritative and lives in the API's brewing module, so advice and
 * stored diagnoses can never disagree between clients.
 */
export type ExtractionDiagnosis = 'over_extracted' | 'under_extracted' | 'balanced' | 'unclear';

// --- Recipes ---------------------------------------------------------------

export type RecipeVisibility = 'private' | 'unlisted' | 'public';

export interface Recipe {
  id: string;
  author_id: string;
  title: string;
  /** Target coffee, or null for a style-level recipe ("any light washed"). */
  coffee_product_id: string | null;
  coffee_style: string | null;
  method: BrewMethod;
  brewer_model_id: string | null;
  grind: GrindSetting;
  params: BrewParams;
  params_schema_version: number;
  /** Fork lineage (§6.6). Attribution is permanent. */
  parent_recipe_id: string | null;
  /** Fields changed relative to the parent — the signal that powers grind
   *  conversion learning and "what people change" insight. */
  changed_fields: string[];
  version: number;
  visibility: RecipeVisibility;
  is_official: boolean;
  created_at: string;
  updated_at: string;
}

// --- Brew sessions ---------------------------------------------------------

/** How the log was created — Path A/B/C in docs/brew_logger_ux.md. */
export type BrewSource = 'repeat' | 'tweak' | 'new' | 'import';

export interface BrewSession {
  /** Client-generated UUIDv7 so the offline queue is retry-safe (EF §2.2). */
  id: string;
  user_id: string;
  recipe_id: string | null;
  coffee_product_id: string | null;
  roast_batch_id: string | null;
  brewer_model_id: string | null;
  grinder_model_id: string | null;
  grind: GrindSetting;
  /** What was actually done, which may differ from the recipe. */
  params: BrewParams;
  params_schema_version: number;
  water?: WaterProfile;
  taste?: TasteResult;
  measurements?: Measurements;
  /** 1–5 overall. Optional: an unrated repeat is still useful data. */
  rating?: number;
  /** Which fields the user changed vs. the previous session — the
   *  one-variable-at-a-time discipline captured for free. */
  changed_fields: string[];
  source: BrewSource;
  photo_media_id?: string | null;
  brewed_at: string;
  created_at: string;
  updated_at: string;
}

/** The prefill payload the logger opens with (Path A/B). */
export interface BrewPrefill {
  coffee_product_id: string | null;
  recipe_id: string | null;
  brewer_model_id: string | null;
  grinder_model_id: string | null;
  grind: GrindSetting;
  params: BrewParams;
  /** Where the prefill came from, for honest UI copy. */
  basis: 'last_session' | 'official_recipe' | 'community_recipe' | 'defaults';
  last_session_id?: string;
}

// --- Offline sync (EF §2.2) ------------------------------------------------

export type SyncResourceType = 'brew_session' | 'recipe';

export interface SyncChange<T = unknown> {
  type: SyncResourceType;
  id: string;
  updated_at: string;
  deleted?: boolean;
  resource?: T;
}

export interface SyncChangesResponse {
  changes: SyncChange[];
  /** Opaque; pass back as `since` on the next pull. */
  cursor: string;
  has_more: boolean;
}

/** Result of an idempotent upsert. `conflict_copy_id` is set when a recipe was
 *  edited server-side too and we forked rather than silently overwrote. */
export interface SyncUpsertResult {
  id: string;
  applied: 'created' | 'updated' | 'noop' | 'conflict_copy';
  conflict_copy_id?: string;
  updated_at: string;
}

// --- Grind conversion capture (§6.4) --------------------------------------

/** Recorded only after a fork produced a brew the user rated good — never from
 *  an unconfirmed guess (risk #9). */
export interface GrindConversionObservation {
  from_model_id: string;
  from_setting: string;
  to_model_id: string;
  to_setting: string;
  brew_session_id: string;
}

export interface GrindConversionSuggestion {
  to_model_id: string;
  suggested_setting: string | null;
  category: GrindCategory;
  confidence: number;
  sample_size: number;
  source: 'user_confirmed' | 'seeded' | 'category_only';
  /** Human-readable honesty string for the UI — never present a converted
   *  setting as exact (§6.4). */
  disclaimer: string;
}
