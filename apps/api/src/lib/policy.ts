/**
 * Central authorization policy layer — EF §3.2.
 *
 * THE RULE: every handler resolves (actor, action, resource) through `authorize()`.
 * No inline `if (user.id === row.owner_id)` anywhere in a route handler — scattered
 * ownership checks are how IDOR bugs are born. A resource type with no registered
 * policy is INACCESSIBLE (default deny), so forgetting to write a policy fails
 * closed rather than open.
 *
 * The AI tool layer (M3) calls this same function with the requesting user's actor,
 * which is what makes it structurally impossible for the model to read another
 * user's private data (EF §3.4).
 */

export type Role = 'user' | 'moderator' | 'editor' | 'seller_owner' | 'admin';

/** The authenticated (or anonymous) caller. */
export interface Actor {
  /** null = unauthenticated request. */
  userId: string | null;
  role: Role | null;
  /** True when the session was established with MFA — required for staff actions. */
  mfa?: boolean;
}

export const ANONYMOUS: Actor = { userId: null, role: null };

export type Action = 'read' | 'create' | 'update' | 'delete' | 'list' | 'moderate' | 'publish';

/**
 * A policy answers: may this actor perform this action on this resource?
 * `resource` is `undefined` for type-level actions (create/list).
 * Return true to allow. Anything else denies.
 */
export type Policy<TResource = unknown> = (
  actor: Actor,
  action: Action,
  resource: TResource | undefined,
) => boolean | Promise<boolean>;

const registry = new Map<string, Policy<never>>();

/** Registers the policy for a resource type. Called once per module at startup. */
export function definePolicy<TResource>(resourceType: string, policy: Policy<TResource>): void {
  if (registry.has(resourceType)) {
    throw new Error(`Policy already registered for resource type '${resourceType}'`);
  }
  registry.set(resourceType, policy as Policy<never>);
}

/** Test-only: drop all registered policies. */
export function resetPolicies(): void {
  registry.clear();
}

export class AuthorizationError extends Error {
  readonly statusCode: number;
  readonly resourceType: string;
  readonly action: Action;

  constructor(resourceType: string, action: Action, actor: Actor) {
    // 401 when nobody is logged in (the client can fix that by authenticating),
    // 403 when a known actor simply lacks permission.
    super(`Not authorized to ${action} ${resourceType}`);
    this.name = 'AuthorizationError';
    this.statusCode = actor.userId === null ? 401 : 403;
    this.resourceType = resourceType;
    this.action = action;
  }
}

/**
 * Default-deny authorization check. Throws `AuthorizationError` unless an
 * explicitly registered policy returns true.
 *
 * Handlers should let the error propagate — the shared error handler maps it to
 * a 401/403 response body without leaking whether the resource exists.
 */
export async function authorize<TResource>(
  actor: Actor,
  action: Action,
  resourceType: string,
  resource?: TResource,
): Promise<void> {
  const policy = registry.get(resourceType) as Policy<TResource> | undefined;
  if (!policy) throw new AuthorizationError(resourceType, action, actor); // unregistered = denied
  const allowed = await policy(actor, action, resource);
  if (allowed !== true) throw new AuthorizationError(resourceType, action, actor);
}

/** Non-throwing variant, for filtering lists or deciding what to render. */
export async function can<TResource>(
  actor: Actor,
  action: Action,
  resourceType: string,
  resource?: TResource,
): Promise<boolean> {
  try {
    await authorize(actor, action, resourceType, resource);
    return true;
  } catch {
    return false;
  }
}

// --- Common policy building blocks -----------------------------------------

export const isAuthenticated = (actor: Actor): boolean => actor.userId !== null;

export const hasRole =
  (...roles: Role[]) =>
  (actor: Actor): boolean =>
    actor.role !== null && roles.includes(actor.role);

/** Staff actions additionally require an MFA-backed session (EF §2.3). */
export const isStaff = (actor: Actor): boolean =>
  hasRole('moderator', 'editor', 'admin')(actor) && actor.mfa === true;

export const isOwner = (actor: Actor, ownerId: string | null | undefined): boolean =>
  actor.userId !== null && ownerId != null && actor.userId === ownerId;
