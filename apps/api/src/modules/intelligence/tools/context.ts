/**
 * Tool execution context — EF §3.4 "per-user tool scoping".
 *
 * THE RULE THIS TYPE EXISTS TO ENFORCE: a tool's identity comes from the
 * `Actor` on the request, and from nowhere else. There is no user id in any
 * tool's input schema, no tool takes an owner argument, and every handler that
 * touches per-user data reads `ctx.actor.userId`.
 *
 * That is what makes the attack in EF §3.4 structurally impossible rather than
 * merely absent: even if the model is fully convinced it is talking to an admin,
 * the only user id in scope is the one the session established.
 */

import type { Actor } from '../../../lib/policy.js';
import type { UntrustedFence } from '../prompts/untrusted.js';
import type { IntelligenceDb } from '../types.js';

export interface ToolContext {
  /** The AUTHENTICATED requester. Never derived from model or user text. */
  readonly actor: Actor;
  readonly db: IntelligenceDb;
  /** Fence for wrapping community text inside tool results. */
  readonly fence: UntrustedFence;
  /**
   * Entity ids/slugs this conversation has legitimately surfaced. The output
   * allowlist (output.ts) uses it as a first filter: a reference the model
   * never saw is a hallucination even if it happens to exist in the graph.
   */
  readonly seen: SeenEntities;
}

/** Ids the tool layer has actually returned during this conversation. */
export class SeenEntities {
  readonly coffee = new Set<string>();
  readonly recipe = new Set<string>();
  readonly equipment = new Set<string>();
  readonly brew = new Set<string>();

  add(type: 'coffee' | 'recipe' | 'equipment' | 'brew', id: string | null | undefined): void {
    if (id) this[type].add(id);
  }

  has(type: 'coffee' | 'recipe' | 'equipment' | 'brew', id: string): boolean {
    return this[type].has(id);
  }

  get size(): number {
    return this.coffee.size + this.recipe.size + this.equipment.size + this.brew.size;
  }
}
