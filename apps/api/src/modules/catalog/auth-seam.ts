/**
 * Seam onto the identity lane's auth plugin (`apps/api/src/lib/auth-plugin.ts`).
 *
 * The contract with that lane is fixed:
 *   - `request.actor` is decorated with a `lib/policy.js` `Actor`
 *   - `requireAuth` is an exported Fastify preHandler that 401s anonymous calls
 *
 * Catalog never defines `request.actor` itself, and never augments the Fastify
 * type — reading it structurally keeps this module compiling whether or not the
 * identity lane's module augmentation has landed, and avoids a duplicate
 * `declare module 'fastify'` when it does.
 *
 * The dynamic import below is the ONLY reason this file exists: while the two
 * lanes run in parallel the plugin file may not be on disk yet. At integration
 * the orchestrator can replace `loadRequireAuth` with a plain static import
 * `import { requireAuth } from '../../lib/auth-plugin.js'` — a one-line change,
 * nothing else in the module refers to the plugin.
 */

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { ANONYMOUS, type Actor } from '../../lib/policy.js';
import { unauthorized } from '../../lib/errors.js';

/** Reads the actor decorated by the auth plugin; anonymous when absent. */
export function actorOf(request: FastifyRequest): Actor {
  const decorated = (request as FastifyRequest & { actor?: Actor }).actor;
  return decorated ?? ANONYMOUS;
}

/**
 * Behaviour-identical stand-in used only if the identity lane's plugin has not
 * landed yet. It is strictly a 401 gate — all real permission decisions still
 * go through `authorize()` in the route handlers (default-deny, EF §3.2).
 */
const fallbackRequireAuth: preHandlerHookHandler = (
  request: FastifyRequest,
  _reply: FastifyReply,
  done: (err?: Error) => void,
) => {
  if (actorOf(request).userId === null) {
    done(unauthorized());
    return;
  }
  done();
};

const AUTH_PLUGIN_SPECIFIER = '../../lib/auth-plugin.js';

let cached: preHandlerHookHandler | null = null;

/** Resolves the identity lane's `requireAuth`, falling back while it is absent. */
export async function loadRequireAuth(): Promise<preHandlerHookHandler> {
  if (cached) return cached;
  try {
    const mod: unknown = await import(/* @vite-ignore */ AUTH_PLUGIN_SPECIFIER);
    const candidate = (mod as { requireAuth?: preHandlerHookHandler }).requireAuth;
    cached = typeof candidate === 'function' ? candidate : fallbackRequireAuth;
  } catch {
    cached = fallbackRequireAuth;
  }
  return cached;
}

/** Test-only: forget the resolved preHandler. */
export function resetRequireAuthCache(): void {
  cached = null;
}
