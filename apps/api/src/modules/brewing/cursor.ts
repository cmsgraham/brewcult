/**
 * Opaque keyset cursors, same shape and rules as the catalog module's
 * (`modules/catalog/cursor.ts`): base64url JSON of `[timestamp, id]`, decoded
 * defensively and bound as `$n` parameters — never interpolated.
 *
 * Two orderings exist in this module and they are not interchangeable:
 *   * LISTS page backwards through time: `(<time> DESC, id DESC)` — newest brew
 *     first, because that is what a history screen shows.
 *   * SYNC pages forwards: `(updated_at ASC, id ASC)` — a pull must deliver
 *     changes in the order they happened, and a row edited during a pull must
 *     be picked up by the next one rather than skipped.
 *
 * Cursors are validated before use; a tampered cursor is a 400, never a 500 and
 * never a row from someone else's data (the WHERE clause is scoped separately).
 */

import { badRequest } from '../../lib/errors.js';
import { iso as toIso } from './types.js';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const isUuid = (value: string): boolean => UUID_RE.test(value);

export interface Keyset {
  /** ISO-8601 timestamp of the last row on the previous page. */
  ts: string;
  /** Tiebreaker so the ordering is total even when timestamps collide. */
  id: string;
}

export function encodeCursor(key: Keyset): string {
  return Buffer.from(JSON.stringify([key.ts, key.id]), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Keyset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw badRequest('Malformed cursor.');
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) throw badRequest('Malformed cursor.');
  const [ts, id] = parsed as unknown[];
  if (typeof ts !== 'string' || Number.isNaN(Date.parse(ts))) throw badRequest('Malformed cursor.');
  if (typeof id !== 'string' || !isUuid(id)) throw badRequest('Malformed cursor.');
  return { ts, id };
}

/**
 * Trims an over-fetched page (limit + 1 rows) to `limit` and derives the next
 * cursor from the last row actually returned. `key` names the column the page
 * was ordered by, so the same helper serves both orderings above.
 */
export function paginate<T extends { id: string }>(
  rows: T[],
  limit: number,
  key: (row: T) => Date | string,
): { items: T[]; next_cursor: string | null; has_more: boolean } {
  const has_more = rows.length > limit;
  const items = has_more ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const next_cursor =
    has_more && last ? encodeCursor({ ts: toIso(key(last)), id: last.id }) : null;
  return { items, next_cursor, has_more };
}
