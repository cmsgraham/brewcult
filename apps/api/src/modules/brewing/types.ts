/**
 * Brewing module — internal types and the database seam.
 *
 * The wire shapes are NOT redefined here. They come from
 * `packages/shared-types/src/brewing.ts`, which is THE contract this module and
 * the web logger both speak (EF §1.3: contracts before clients). This file adds
 * only what is server-side: row shapes, the query seam, and the input records
 * the repository accepts.
 */

import type {
  BrewParams,
  BrewPrefill,
  BrewSession,
  BrewSource,
  ExtractionDiagnosis,
  GrindCategory,
  GrindConversionSuggestion,
  GrindSetting,
  Measurements,
  ParamsSchemaVersion,
  Recipe,
  RecipeVisibility,
  SyncChange,
  SyncChangesResponse,
  SyncResourceType,
  SyncUpsertResult,
  TasteResult,
  TasteVerdict,
  WaterProfile,
} from '@brewcult/shared-types';

export type {
  BrewParams,
  BrewPrefill,
  BrewSession,
  BrewSource,
  ExtractionDiagnosis,
  GrindCategory,
  GrindConversionSuggestion,
  GrindSetting,
  Measurements,
  Recipe,
  RecipeVisibility,
  SyncChange,
  SyncChangesResponse,
  SyncResourceType,
  SyncUpsertResult,
  TasteResult,
  TasteVerdict,
  WaterProfile,
};

/**
 * The params shape this build writes. `ParamsSchemaVersion` is a literal type in
 * the types-only contract package, so the runtime constant is declared here and
 * checked against it — bumping the contract without bumping this fails the
 * build, which is exactly the drift alarm EF §1.3 asks for.
 */
export const PARAMS_SCHEMA_VERSION: ParamsSchemaVersion = 1;

// ---------------------------------------------------------------------------
// Database seam
// ---------------------------------------------------------------------------

export interface QueryResultLike<T> {
  rows: T[];
}

/**
 * The narrow slice of a Postgres client this module needs. Production wires the
 * shared pool (`lib/db.ts`); tests wire an in-process PGlite instance.
 *
 * `tx` runs a unit of work with a single connection so an outbox event and the
 * write that caused it commit together. The test seam (PGlite) is single
 * connection anyway, so its implementation may simply issue BEGIN/COMMIT.
 */
export interface BrewingDb {
  query<T>(text: string, params?: readonly unknown[]): Promise<QueryResultLike<T>>;
  transaction?<T>(fn: (tx: BrewingDb) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Policy resources — the shapes the policy layer decides on. Deliberately
// minimal: a policy needs ownership and visibility, never the whole row.
// ---------------------------------------------------------------------------

export interface RecipeResource {
  id: string;
  authorId: string;
  visibility: RecipeVisibility;
  isOfficial: boolean;
  deleted: boolean;
}

export interface BrewSessionResource {
  id: string;
  userId: string;
  deleted: boolean;
}

// ---------------------------------------------------------------------------
// Repository input records
// ---------------------------------------------------------------------------

/** The content of a recipe — everything a fork copies and a diff compares. */
export interface RecipeContent {
  title: string;
  coffee_product_id: string | null;
  coffee_style: string | null;
  method: BrewParams['method'];
  brewer_model_id: string | null;
  grind: GrindSetting;
  params: BrewParams;
}

export interface RecipeWriteInput extends RecipeContent {
  id: string;
  author_id: string;
  visibility: RecipeVisibility;
}

export interface BrewSessionWriteInput {
  id: string;
  user_id: string;
  recipe_id: string | null;
  coffee_product_id: string | null;
  roast_batch_id: string | null;
  brewer_model_id: string | null;
  grinder_model_id: string | null;
  grind: GrindSetting;
  params: BrewParams;
  water: WaterProfile | null;
  taste: TasteResult | null;
  measurements: Measurements | null;
  rating: number | null;
  /** Absent = "server, work it out from my previous session for this coffee". */
  changed_fields: string[] | null;
  source: BrewSource;
  photo_media_id: string | null;
  /**
   * When the brew happened. NULL means "the client did not say": a new row gets
   * `now()`, an existing row KEEPS the timestamp it already has — otherwise a
   * re-PUT of an unchanged body would look like a change and break idempotency.
   */
  brewed_at: string | null;
  /** Client's view of the row's last modification, for last-write-wins. */
  client_updated_at: string | null;
}

// ---------------------------------------------------------------------------
// Row shapes (what SQL returns; never handed to clients unprojected)
// ---------------------------------------------------------------------------

export interface RecipeRow {
  id: string;
  author_id: string;
  title: string;
  coffee_product_id: string | null;
  coffee_style: string | null;
  method: Recipe['method'];
  brewer_model_id: string | null;
  grind: GrindSetting;
  params: BrewParams;
  params_schema_version: number;
  parent_recipe_id: string | null;
  conflict_of_recipe_id: string | null;
  changed_fields: string[] | null;
  version: number;
  visibility: RecipeVisibility;
  is_official: boolean;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface BrewSessionRow {
  id: string;
  user_id: string;
  recipe_id: string | null;
  coffee_product_id: string | null;
  roast_batch_id: string | null;
  brewer_model_id: string | null;
  grinder_model_id: string | null;
  grind: GrindSetting;
  params: BrewParams;
  params_schema_version: number;
  water: WaterProfile | null;
  taste: TasteResult | null;
  measurements: Measurements | null;
  rating: number | null;
  changed_fields: string[] | null;
  source: BrewSource;
  photo_media_id: string | null;
  brewed_at: Date | string;
  body_hash: string;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  diagnosis: ExtractionDiagnosis;
}

/**
 * A session row joined to the names its foreign keys point at.
 *
 * Every label is nullable and that is the normal case, not the edge: a brew
 * logged against a quick-add bag has no `coffee_product_id` to join on, and one
 * logged before the brewer was picked has no equipment either. A history list
 * must render those brews too — they are usually somebody's first.
 */
export interface BrewSessionLabelledRow extends BrewSessionRow {
  coffee_label: string | null;
  coffee_slug: string | null;
  roaster_label: string | null;
  brewer_label: string | null;
}

/** What `GET /v1/brews` returns: the session plus what its ids mean. */
export interface LabelledBrewSession extends BrewSession {
  coffee_label: string | null;
  coffee_slug: string | null;
  roaster_label: string | null;
  brewer_label: string | null;
}

// ---------------------------------------------------------------------------
// List/page shapes
// ---------------------------------------------------------------------------

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export interface RecipeReview {
  id: string;
  recipe_id: string;
  user_id: string;
  rating: number;
  body: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Normalises a timestamp to ISO-8601. Drivers differ — `pg` hands back `Date`,
 * other engines hand back Postgres' own text form ("2026-08-04 09:00:00+00") —
 * and sync cursors are compared as STRINGS, so a mixed representation would
 * silently corrupt the ordering. Everything funnels through here.
 */
export const iso = (value: Date | string): string => {
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
};
