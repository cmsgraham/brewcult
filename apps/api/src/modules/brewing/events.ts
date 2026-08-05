/**
 * Domain events via the transactional outbox — BREW-08, EF §1.2/§5.2.
 *
 * WHICH MECHANISM AND WHY: F-12 ("transactional outbox + event bus skeleton")
 * had not landed when this lane ran and the repository contained no outbox of
 * any kind — only the worker entrypoint's TODO. Rather than invent a second
 * mechanism, 0006_brewing.sql defines a minimal, general `domain_events` table
 * and this file is its only writer today. F-12 should adopt the table and add
 * the relay; nothing here is brewing-specific except the event names.
 *
 * The rule that makes it an outbox rather than a log: the INSERT happens on the
 * SAME connection/transaction as the write it describes, so an event can never
 * announce a write that rolled back, and a write can never commit without its
 * event. Callers therefore pass the transaction handle, not the pool.
 *
 * Events are versioned, append-only contracts (`brew.logged.v1`). Consumers
 * tolerate unknown fields; a breaking change means a new `.v2`, never an edit.
 * Payloads carry identifiers and decisions only — never taste prose, never
 * personal data (EF §4.1 minimisation).
 */

import type { BrewingDb } from './types.js';

export type BrewingEventType =
  | 'brew.logged.v1'
  | 'brew.deleted.v1'
  | 'recipe.created.v1'
  | 'recipe.forked.v1'
  | 'recipe.conflict_copy_created.v1'
  | 'grind_conversion.confirmed.v1';

export interface DomainEventInput {
  type: BrewingEventType;
  aggregateType: 'brew_session' | 'recipe' | 'grind_conversion';
  aggregateId: string;
  actorId: string | null;
  payload?: Record<string, unknown>;
}

export async function emitDomainEvent(db: BrewingDb, event: DomainEventInput): Promise<void> {
  await db.query(
    `INSERT INTO domain_events (event_type, aggregate_type, aggregate_id, actor_id, payload)
     VALUES ($1, $2, $3, $4::uuid, $5::jsonb)`,
    [
      event.type,
      event.aggregateType,
      event.aggregateId,
      event.actorId,
      JSON.stringify(event.payload ?? {}),
    ],
  );
}
