/**
 * Opaque keyset cursors for the admin list endpoints (§22: "cursor pagination").
 *
 * Same contract as `modules/catalog/cursor.ts` — base64url JSON, opaque to
 * clients, validated before any field reaches SQL as a bound parameter — with
 * one difference: the admin surface pages over `audit_log`, whose primary key
 * is a `bigint` identity column rather than a uuid. So the id is validated as
 * "a short, printable key" instead of "a uuid", and every query that uses it
 * casts explicitly (`$n::uuid`, `$n::bigint`) so a value of the wrong shape is
 * a database-level 400 rather than a silent full scan.
 *
 * Offset pagination is not an option here: an operator paging through a user
 * list while registrations arrive would see rows twice or not at all.
 */

import { badRequest } from '../../lib/errors.js';

export interface Keyset {
  /** ISO-8601 timestamp of the last row on the previous page. */
  created_at: string;
  /** Tiebreaker so the ordering is total even when timestamps collide. */
  id: string;
}

/** Conservative: uuids, bigints and nothing exotic. */
const ID_RE = /^[0-9a-zA-Z-]{1,64}$/;

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
  if (typeof id !== 'string' || !ID_RE.test(id)) throw badRequest('Malformed cursor.');
  return { created_at: createdAt, id };
}

/**
 * Trims an over-fetched page (limit + 1 rows) down to `limit` and derives the
 * next page's cursor from the last row actually returned.
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
