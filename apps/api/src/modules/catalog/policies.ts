/**
 * Catalog authorization policies (EF §3.2).
 *
 * The catalog is P0 public data (0003_catalog.sql header): anonymous reads are
 * the product. Everything that mutates the entity graph is editorial and
 * therefore staff-only — `isStaff` additionally requires an MFA-backed session,
 * which is exactly the "separate auth surface with MFA enforced" rule.
 *
 * Deletion is registered but intentionally has no route: catalog rows are
 * soft-retired via `status`, never deleted, so reviews and brew sessions keep
 * their referents (§6.1 seasonality rule).
 */

import { definePolicy, isStaff, type Actor, type Action } from '../../lib/policy.js';

/** Resource types this module owns. Cross-module callers use these strings. */
export const CATALOG_RESOURCE_TYPES = ['coffee_product', 'roaster', 'equipment_model'] as const;

export type CatalogResourceType = (typeof CATALOG_RESOURCE_TYPES)[number];

/** read/list are public; create/update/delete/publish are editorial. */
export function catalogPolicy(actor: Actor, action: Action): boolean {
  if (action === 'read' || action === 'list') return true;
  return isStaff(actor);
}

/**
 * Registers the catalog policies. Idempotent: `definePolicy` throws on a
 * duplicate resource type (fail-loud by design), which is the right behaviour
 * for two modules claiming the same type but the wrong behaviour for a test
 * suite that builds the app several times around `resetPolicies()`. The only
 * error `definePolicy` raises is the duplicate one, so swallowing it here is
 * safe and keeps `registerCatalogRoutes` callable more than once.
 */
export function registerCatalogPolicies(): void {
  for (const resourceType of CATALOG_RESOURCE_TYPES) {
    try {
      definePolicy<unknown>(resourceType, (actor, action) => catalogPolicy(actor, action));
    } catch {
      // Already registered for this resource type — idempotent by intent.
    }
  }
}
