/**
 * Text helpers for the catalog module.
 *
 * Every function here produces *values* that are passed as bound parameters —
 * nothing in this file is ever concatenated into SQL (EF §3.3).
 */

import { badRequest } from '../../lib/errors.js';

/**
 * Escapes the LIKE/ILIKE metacharacters so a user's query string can only ever
 * match literally. Used with `ESCAPE '\'` in the SQL, so the pattern itself is
 * still a bound parameter.
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Collapses whitespace and trims; the canonical form of a user search string. */
export function normaliseQuery(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Unicode combining diacritical marks (U+0300–U+036F). Built from an ASCII
 * source string so the class stays readable in the file.
 */
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * URL slug from a display name: lowercase, ASCII-folded, hyphen-separated.
 * Must satisfy the `^[a-z0-9]+(-[a-z0-9]+)*$` CHECK on every slug column.
 *
 * NFKD splits an accented letter into base + combining mark; the marks are then
 * dropped rather than turned into separators, so "Ålesund" slugs to "alesund"
 * and not "a-lesund".
 */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length === 0) {
    throw badRequest('Could not derive a slug from the supplied name; pass `slug` explicitly.');
  }
  return slug;
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Validates a client-supplied slug against the same rule the database enforces. */
export function assertValidSlug(slug: string): string {
  if (!SLUG_PATTERN.test(slug)) {
    throw badRequest(`Invalid slug '${slug}': expected lowercase words separated by hyphens.`);
  }
  return slug;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);
