/**
 * Intelligence authorization policies — EF §3.2.
 *
 * This module owns one resource type: `ai_assistant`, the right to spend model
 * tokens on this deployment. The interesting authorization in this lane is NOT
 * here — it is in `tools/registry.ts`, where every graph read is authorized
 * against brewing's and catalog's policies with the requester's actor. This
 * policy only answers "may this actor use the assistant at all".
 *
 * Anonymous is denied outright: an unauthenticated caller has no brew history to
 * ground on, no budget to spend against, and would make the per-user token cap
 * (EF §3.4's cost-abuse control) unenforceable.
 */

import { definePolicy, isAuthenticated, type Action, type Actor, type Policy } from '../../lib/policy.js';

export const AI_ASSISTANT_RESOURCE = 'ai_assistant';

export const INTELLIGENCE_RESOURCE_TYPES = [AI_ASSISTANT_RESOURCE] as const;

export type IntelligenceResourceType = (typeof INTELLIGENCE_RESOURCE_TYPES)[number];

/**
 * `create` = ask the assistant something (it consumes budget).
 * `read`   = read your own usage/budget state.
 * Everything else, including anything staff-shaped, is denied: there is no
 * "ask on behalf of" action, by design.
 */
export const aiAssistantPolicy: Policy<never> = (actor: Actor, action: Action) => {
  if (action === 'create' || action === 'read') return isAuthenticated(actor);
  return false;
};

/** Idempotent registration (same pattern as brewing/catalog). */
export function registerIntelligencePolicies(): void {
  try {
    definePolicy<never>(AI_ASSISTANT_RESOURCE, aiAssistantPolicy);
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('already registered')) throw err;
  }
}
