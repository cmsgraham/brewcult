/**
 * Catalog module — public interface (EF §1.2).
 *
 * This file is the module's entire contract. Nothing outside
 * `apps/api/src/modules/catalog/**` may import any other file in this folder;
 * `.dependency-cruiser.cjs` fails the build if it tries.
 *
 * The catalog owns the entity-graph core (second_draft §5, §21.2): roasters,
 * origins, farms, coffee lots, coffee products, roast batches, equipment brands
 * and models, and the crowd-sourced grind-conversion table (§6.4).
 *
 * Usage from the server bootstrap:
 * ```ts
 * import { registerCatalogRoutes } from './modules/catalog/index.js';
 * await registerCatalogRoutes(app);
 * ```
 */

import type { FastifyInstance } from 'fastify';
import { registerCatalogPolicies } from './policies.js';
import { registerCatalogRoutes as registerRoutes, type CatalogRouteOptions } from './routes.js';

/**
 * Registers the catalog policies and every catalog route.
 *
 * Policies are registered first and unconditionally: a resource type with no
 * policy is inaccessible (default deny), so route registration without policy
 * registration would produce a silently 403-ing API.
 */
export async function registerCatalogRoutes(
  app: FastifyInstance,
  options: CatalogRouteOptions = {},
): Promise<void> {
  registerCatalogPolicies();
  await registerRoutes(app, options);
}

// --- policy surface --------------------------------------------------------

export {
  CATALOG_RESOURCE_TYPES,
  catalogPolicy,
  registerCatalogPolicies,
  type CatalogResourceType,
} from './policies.js';

// --- read surface for other modules (brewing, community, intelligence) -----
//
// Cross-module callers must go through these functions rather than querying
// catalog tables directly. Each takes the same `CatalogDb` seam the routes use.

export {
  autocomplete,
  getCoffeeBySlug,
  getEquipmentById,
  getEquipmentBySlug,
  getRoasterBySlug,
  listCoffees,
  listEquipment,
  listEquipmentBrands,
  listGrindConversions,
  listOrigins,
  listRoasters,
  search,
  defaultCatalogDb,
  type CatalogDb,
  type CoffeeListFilters,
  type SearchType,
} from './repository.js';

export type { CatalogRouteOptions } from './routes.js';

// --- DTO types -------------------------------------------------------------

export type {
  AutocompleteItem,
  CoffeeDetail,
  CoffeeLot,
  CoffeeStatus,
  CoffeeSummary,
  EquipmentBrandRef,
  EquipmentCategory,
  EquipmentDetail,
  EquipmentSummary,
  FarmRef,
  GrindConversion,
  GrindConversionResponse,
  GrindConversionSource,
  GrindModelRef,
  GrindScaleType,
  GrindUncertainty,
  IntendedUse,
  LotProcess,
  OriginRef,
  OriginSummary,
  Page,
  RoastBatch,
  RoastLevel,
  RoasterDetail,
  RoasterRef,
  RoasterSummary,
  SearchHit,
} from './types.js';
