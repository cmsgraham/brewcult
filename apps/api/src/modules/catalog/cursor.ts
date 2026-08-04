/**
 * Opaque keyset cursors for catalog list endpoints (§22: "cursor pagination").
 *
 * Offset pagination drifts when rows are inserted mid-scroll; every catalog
 * list therefore pages on the total order `(created_at DESC, id DESC)` and
 * encodes the last row's key into the cursor. The encoding is base64url JSON —
 * opaque to clients, cheap to debug, and never trusted: `decodeCursor`
 * validates both fields before they reach SQL as bound parameters.
 */

import { badRequest } from '../../lib/errors.js';
import { isUuid } from './text.js';

export interface Keyset {
  /** ISO-8601 timestamp of the last row on the previous page. */
  created_at: string;
  /** Tiebreaker so the ordering is total even when timestamps collide. */
  id: string;
}

export function encodeCursor(key: Keyset): string {
  return Buffer.from(JSON.stringify([key.created_at, key.id]), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Keyset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw badRequest('Malformed cursor.');
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) throw badRequest('Malformed cursor.');
  const [createdAt, id] = parsed as unknown[];
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
    throw badRequest('Malformed cursor.');
  }
  if (typeof id !== 'string' || !isUuid(id)) throw badRequest('Malformed cursor.');
  return { created_at: createdAt, id };
}

/**
 * Trims an over-fetched page (limit + 1 rows) down to `limit` and derives the
 * cursor for the next page from the last row actually returned.
 */
export function paginate<T extends { id: string; created_at: string | Date }>(
  rows: T[],
  limit: number,
): { items: T[]; next_cursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const next_cursor =
    hasMore && last
      ? encodeCursor({
          created_at:
            last.created_at instanceof Date ? last.created_at.toISOString() : last.created_at,
          id: last.id,
        })
      : null;
  return { items, next_cursor };
}
