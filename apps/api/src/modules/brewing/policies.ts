/**
 * Brewing authorization policies — EF §3.2, backlog REC-05.
 *
 * Every brewing handler resolves (actor, action, resource) through
 * `authorize()`. There is no ownership `if` anywhere else in this module, and
 * no route reads a row without first passing the loaded row back through a
 * policy — that ordering is what makes IDOR structurally impossible rather than
 * merely absent today.
 *
 * Classification drives the defaults (EF §4.1):
 *   * brew sessions are P1 pseudonymous activity — PER-USER ACCESS ONLY. Staff
 *     get nothing here. A moderator reading someone's brew history is
 *     surveillance, not moderation, and the same reasoning already governs the
 *     identity module's device list.
 *   * recipes are P0 public when published and P1 while private, so the policy
 *     is visibility-driven and defaults to `private`.
 */

import {
  type Action,
  type Actor,
  definePolicy,
  isAuthenticated,
  isOwner,
  isStaff,
  type Policy,
} from '../../lib/policy.js';
import type { BrewSessionResource, RecipeResource } from './types.js';

export const RECIPE_RESOURCE = 'recipe';
export const BREW_SESSION_RESOURCE = 'brew_session';
/** Read-only projection over catalog's crowd-sourced conversion table (§6.4). */
export const GRIND_SUGGESTION_RESOURCE = 'grind_conversion_suggestion';

export const BREWING_RESOURCE_TYPES = [
  RECIPE_RESOURCE,
  BREW_SESSION_RESOURCE,
  GRIND_SUGGESTION_RESOURCE,
] as const;

export type BrewingResourceType = (typeof BREWING_RESOURCE_TYPES)[number];

/**
 * `recipe` policy (REC-05).
 *
 *  - create: any authenticated user.
 *  - list:   allowed for everyone; the handler decides WHICH rows by asking
 *            this same policy about each candidate, so an anonymous browse can
 *            only ever surface public rows.
 *  - read:   public → anyone. unlisted → anyone who has the id (that is what
 *            "unlisted" means: unguessable, not secret). private → the author.
 *            A soft-deleted recipe is readable only by its author, so a client
 *            that still holds the id learns it is gone without leaking content.
 *  - update/delete: the author, and only the author. Staff cannot quietly edit
 *            someone's recipe; they act through `moderate`, which is audited.
 *  - publish: staff — this is the `is_official` flag, i.e. "BrewCult/the roaster
 *            vouches for this recipe", which a user must not be able to grant
 *            themselves.
 */
export const recipePolicy: Policy<RecipeResource> = (
  actor: Actor,
  action: Action,
  resource: RecipeResource | undefined,
) => {
  if (action === 'create') return isAuthenticated(actor);
  if (action === 'list') return true;
  if (!resource) return false;

  switch (action) {
    case 'read':
      if (resource.deleted) return isOwner(actor, resource.authorId);
      if (resource.visibility === 'public' || resource.visibility === 'unlisted') return true;
      return isOwner(actor, resource.authorId);
    case 'update':
    case 'delete':
      return isOwner(actor, resource.authorId);
    case 'publish':
    case 'moderate':
      return isStaff(actor);
    default:
      return false;
  }
};

/**
 * `brew_session` policy (BREW-01/BREW-05).
 *
 * One rule, no exceptions: a brew session belongs to exactly one user and only
 * that user may see or change it. `list` is allowed for any authenticated
 * caller because the handler additionally re-checks every row it is about to
 * return through `can(actor, 'read', ...)` — the WHERE clause is an
 * optimisation, the policy is the guarantee.
 */
export const brewSessionPolicy: Policy<BrewSessionResource> = (
  actor: Actor,
  action: Action,
  resource: BrewSessionResource | undefined,
) => {
  if (actor.userId === null) return false;
  if (action === 'create' || action === 'list') return true;
  if (!resource) return false;
  if (action === 'read' || action === 'update' || action === 'delete') {
    return isOwner(actor, resource.userId);
  }
  return false;
};

/**
 * `grind_conversion_suggestion` policy — the read side of §6.4. Conversions are
 * aggregate community data with no user linkage (that lives in
 * brew_grind_observations, which has no HTTP surface at all), so reading one is
 * as public as reading the catalog.
 */
export const grindSuggestionPolicy: Policy<never> = (_actor, action) =>
  action === 'read' || action === 'list';

/**
 * Idempotent registration — `definePolicy` refuses duplicates by design, but a
 * test run that builds several apps around `resetPolicies()` must not explode.
 */
export function registerBrewingPolicies(): void {
  define<RecipeResource>(RECIPE_RESOURCE, recipePolicy);
  define<BrewSessionResource>(BREW_SESSION_RESOURCE, brewSessionPolicy);
  define<never>(GRIND_SUGGESTION_RESOURCE, grindSuggestionPolicy);
}

function define<T>(resourceType: string, policy: Policy<T>): void {
  try {
    definePolicy(resourceType, policy);
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('already registered')) throw err;
  }
}
