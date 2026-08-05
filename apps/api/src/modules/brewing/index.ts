/**
 * BREWING MODULE — PUBLIC INTERFACE (EF §1.2, backlog REC-01..07, BREW-01/05/08,
 * GC-02/03).
 *
 * This file is the module's entire contract. `.dependency-cruiser.cjs` makes any
 * import of `modules/brewing/<anything-else>` from outside a hard error, so
 * everything another lane needs appears below — and nothing below can change
 * without noticing who depends on it.
 *
 * Wiring in `apps/api/src/app.ts` is two lines:
 *
 *     import { registerBrewingRoutes } from './modules/brewing/index.js';
 *     await registerBrewingRoutes(app);
 *
 * Route map:
 *   GET    /v1/recipes                     public + own; keyset cursor
 *   POST   /v1/recipes                     201; server- or client-minted id
 *   GET    /v1/recipes/:id                 visibility-policed
 *   GET    /v1/recipes/:id/lineage         §6.6 attribution + change count
 *   PUT    /v1/recipes/:id                 idempotent upsert → SyncUpsertResult
 *                                          (conflict-copy on a stale base_version)
 *   PATCH  /v1/recipes/:id                 author only
 *   DELETE /v1/recipes/:id                 author only; soft delete (tombstone)
 *   POST   /v1/recipes/:id/fork            201; parent + real diff + attribution
 *   GET    /v1/recipes/:id/reviews
 *   PUT    /v1/recipes/:id/reviews         one review per user per recipe
 *   GET    /v1/brews/prefill?coffee_product_id=&method=   → BrewPrefill
 *   GET    /v1/brews                       own only; filters coffee/recipe/date
 *   GET    /v1/brews/:id                   own only
 *   PUT    /v1/brews/:id                   idempotent upsert → SyncUpsertResult
 *   DELETE /v1/brews/:id                   soft delete (tombstone)
 *   GET    /v1/sync/changes?since=&types=  → SyncChangesResponse (own rows only)
 *   GET    /v1/grind-conversions/suggest   → GrindConversionSuggestion
 *
 * Conventions other lanes should know about:
 *   * `changed_fields` uses dotted LEAF paths, sorted: `grind.setting`,
 *     `params.dose_g`, `brewer_model_id`. `params.ratio` is never emitted
 *     (derived). A UI that only wants "grind changed" can prefix-match.
 *   * Recipes and brew sessions both take CLIENT-MINTED UUIDv7 ids. PUT is the
 *     retry-safe write; POST exists for the online create path only.
 *   * Sessions resolve conflicts last-write-wins; recipes NEVER overwrite — a
 *     stale `base_version` produces a "(conflicted copy)" row instead.
 */

import type { FastifyInstance } from 'fastify';
import { registerBrewingPolicies } from './policies.js';
import { registerBrewingRoutes as registerRoutes, type BrewingRouteOptions } from './routes.js';

/**
 * Registers the brewing policies and every brewing route.
 *
 * Policies are registered first and unconditionally: a resource type with no
 * policy is inaccessible (default deny), so registering routes without
 * registering policies would produce a silently 403-ing API.
 */
export async function registerBrewingRoutes(
  app: FastifyInstance,
  options: BrewingRouteOptions = {},
): Promise<void> {
  registerBrewingPolicies();
  await registerRoutes(app, options);
}

export type { BrewingRouteOptions } from './routes.js';

// --- policy surface --------------------------------------------------------

export {
  BREWING_RESOURCE_TYPES,
  BREW_SESSION_RESOURCE,
  GRIND_SUGGESTION_RESOURCE,
  RECIPE_RESOURCE,
  brewSessionPolicy,
  grindSuggestionPolicy,
  recipePolicy,
  registerBrewingPolicies,
  type BrewingResourceType,
} from './policies.js';

// --- taste → diagnosis (§6.7) ----------------------------------------------
/**
 * THE server-authoritative mapping, exported for the intelligence/AI module so
 * advice and stored diagnoses can never disagree. It is duplicated in exactly
 * one other place — the `brew_sessions.diagnosis` generated column in
 * 0006_brewing.sql — and the test suite asserts the two agree.
 */
export { TASTE_VERDICTS, diagnoseTaste, isRatedGood } from './taste.js';

// --- cross-module read helpers ---------------------------------------------
//
// Other modules (intelligence, community, trust) call these instead of querying
// brewing tables. Each takes the same `BrewingDb` seam the routes use. Callers
// are responsible for authorizing the actor first — `recipePolicy` and
// `brewSessionPolicy` above are exported for exactly that.

export {
  defaultBrewingDb,
  findBrewSessionResource,
  findPrefill,
  findRecipeResource,
  getBrewSessionRow,
  getRecipeLineage,
  getRecipeRow,
  listBrewSessionRows,
  listRecipeChanges,
  listRecipeReviews,
  listRecipeRows,
  listSessionChanges,
  toBrewSession,
  toRecipe,
  type BrewListFilters,
  type GrindObservation,
  type PrefillRow,
  type RecipeListFilters,
  type SyncRow,
} from './repository.js';

// --- domain events (BREW-08) -----------------------------------------------
/**
 * The outbox this module emits through. `domain_events` is defined in
 * 0006_brewing.sql because F-12's outbox had not landed; F-12 should adopt the
 * table and add the relay rather than build a second one.
 */
export { emitDomainEvent, type BrewingEventType, type DomainEventInput } from './events.js';

// --- diff / params helpers --------------------------------------------------
/** `changed_fields` computation, shared with the intelligence module's insights. */
export { diffRecipes, diffSessions, type DiffableRecipe, type DiffableSession } from './diff.js';
export {
  assertParamsMatchMethod,
  canonicalJson,
  normaliseGrind,
  normaliseParams,
} from './params.js';

// --- types ------------------------------------------------------------------
//
// The wire shapes live in `@brewcult/shared-types` (packages/shared-types/src/
// brewing.ts) and are re-exported here so a consumer needs one import.

export {
  PARAMS_SCHEMA_VERSION,
  type BrewParams,
  type BrewPrefill,
  type BrewSession,
  type BrewSessionResource,
  type BrewSessionRow,
  type BrewSource,
  type BrewingDb,
  type ExtractionDiagnosis,
  type GrindCategory,
  type GrindConversionSuggestion,
  type GrindSetting,
  type Measurements,
  type Page,
  type Recipe,
  type RecipeResource,
  type RecipeReview,
  type RecipeRow,
  type RecipeVisibility,
  type SyncChange,
  type SyncChangesResponse,
  type SyncResourceType,
  type SyncUpsertResult,
  type TasteResult,
  type TasteVerdict,
  type WaterProfile,
} from './types.js';
