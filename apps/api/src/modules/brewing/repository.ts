/**
 * Brewing repository — the ONLY place in the module that writes SQL.
 *
 * Rules (EF §3.3, EF §1.2):
 *  - Parameterised queries only. The only strings concatenated into a statement
 *    are fixed, developer-authored fragments in this file.
 *  - Tables owned by this module (db/migrations/0006_brewing.sql): recipes,
 *    recipe_reviews, brew_sessions, brew_grind_observations, domain_events.
 *  - `grind_conversions` belongs to the CATALOG module. This file writes to it
 *    in exactly one function — `captureGrindConversion` — because GC-02 is a
 *    brewing-side rule (a confirmed pair only exists as the consequence of a
 *    rated-good brew) and catalog exposes no writer for it. Flagged in the lane
 *    report: catalog should publish `recordConfirmedGrindConversion()` and this
 *    call should move behind it. The READ side already goes through catalog's
 *    public `listGrindConversions()`; see routes.ts.
 *
 * Route handlers never see rows — the row → DTO mapping lives at the bottom.
 */

import type { QueryResultRow } from 'pg';
import { query as poolQuery, transaction as poolTransaction } from '../../lib/db.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { decodeCursor } from './cursor.js';
import { diffRecipes, diffSessions, type DiffableSession } from './diff.js';
import { bodyHash, normaliseGrind, normaliseParams } from './params.js';
import { isRatedGood } from './taste.js';
import {
  iso,
  PARAMS_SCHEMA_VERSION,
  type BrewParams,
  type BrewSession,
  type BrewSessionResource,
  type BrewSessionRow,
  type BrewSessionWriteInput,
  type BrewingDb,
  type GrindSetting,
  type Recipe,
  type RecipeContent,
  type RecipeResource,
  type RecipeReview,
  type RecipeRow,
  type RecipeVisibility,
  type RecipeWriteInput,
  type SyncUpsertResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Database seam
// ---------------------------------------------------------------------------

/** Default seam: the shared application pool. */
export const defaultBrewingDb: BrewingDb = {
  query: async <T>(text: string, params: readonly unknown[] = []) =>
    poolQuery(text, params) as unknown as Promise<{ rows: T[] }>,
  transaction: async <T>(fn: (tx: BrewingDb) => Promise<T>): Promise<T> =>
    poolTransaction(async (client) =>
      fn({
        query: async <R>(text: string, params: readonly unknown[] = []) =>
          client.query(text, params as unknown[]) as unknown as Promise<{ rows: R[] }>,
      }),
    ),
};

/**
 * Runs `fn` in a transaction when the seam supports one. A seam without
 * `transaction` (the PGlite test harness is a single connection) runs it inline;
 * the statements are still serialised, which is what the invariants need.
 */
export function withTransaction<T>(db: BrewingDb, fn: (tx: BrewingDb) => Promise<T>): Promise<T> {
  return db.transaction ? db.transaction(fn) : fn(db);
}

/** Adapter for identity's `recordAuditEvent`, which takes a bare exec function. */
export const execOf =
  (db: BrewingDb) =>
  <T extends QueryResultRow = QueryResultRow>(text: string, params?: readonly unknown[]) =>
    db.query<T>(text, params);

// ---------------------------------------------------------------------------
// Postgres error translation
// ---------------------------------------------------------------------------

interface PgErrorLike {
  code?: string;
  constraint?: string;
  message?: string;
}

const pgError = (err: unknown): PgErrorLike =>
  typeof err === 'object' && err !== null ? (err as PgErrorLike) : {};

/**
 * Constraint failures become the right HTTP error instead of a 500.
 * 23503 (FK) means the client referenced a coffee/equipment that does not
 * exist — that is a 400, not a server fault. 23514 (CHECK) means the payload
 * broke a domain rule the JSON Schema does not express (e.g. params.method not
 * matching the recipe's method).
 */
export function translateWriteError(err: unknown, subject: string): never {
  const { code, constraint, message } = pgError(err);
  if (code === '23505') throw conflict(`That ${subject} already exists.`, { constraint });
  if (code === '23503') throw badRequest('Referenced entity does not exist.', { constraint });
  if (code === '23514') throw badRequest(`Value rejected by the ${subject} domain rules.`, { constraint });
  if (code === '22P02') throw badRequest('Malformed identifier.', { message });
  throw err;
}

// ---------------------------------------------------------------------------
// Column lists
// ---------------------------------------------------------------------------

const RECIPE_COLUMNS = `id, author_id, title, coffee_product_id, coffee_style, method,
  brewer_model_id, grind, params, params_schema_version, parent_recipe_id,
  conflict_of_recipe_id, changed_fields, version, visibility, is_official,
  deleted_at, created_at, updated_at`;

const SESSION_COLUMNS = `id, user_id, recipe_id, coffee_product_id, roast_batch_id,
  brewer_model_id, grinder_model_id, grind, params, params_schema_version, water,
  taste, measurements, rating, changed_fields, source, photo_media_id, brewed_at,
  body_hash, deleted_at, created_at, updated_at, diagnosis`;

// ---------------------------------------------------------------------------
// Recipes — reads
// ---------------------------------------------------------------------------

/**
 * Loads the minimal shape the policy layer decides on. Every recipe route calls
 * this BEFORE it does anything else, so authorization happens on the real row
 * rather than on the caller's claim about it.
 */
export async function findRecipeResource(
  db: BrewingDb,
  id: string,
): Promise<RecipeResource | null> {
  const res = await db.query<{
    id: string;
    author_id: string;
    visibility: RecipeVisibility;
    is_official: boolean;
    deleted_at: Date | string | null;
  }>(
    `SELECT id, author_id, visibility, is_official, deleted_at FROM recipes WHERE id = $1::uuid`,
    [id],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    authorId: row.author_id,
    visibility: row.visibility,
    isOfficial: row.is_official,
    deleted: row.deleted_at !== null,
  };
}

export async function getRecipeRow(db: BrewingDb, id: string): Promise<RecipeRow | null> {
  const res = await db.query<RecipeRow>(
    `SELECT ${RECIPE_COLUMNS} FROM recipes WHERE id = $1::uuid`,
    [id],
  );
  return res.rows[0] ?? null;
}

export interface RecipeListFilters {
  authorId?: string;
  coffeeProductId?: string;
  method?: string;
  visibility?: RecipeVisibility;
  isOfficial?: boolean;
  parentRecipeId?: string;
  /** Rows the caller may see: their own plus everything published. */
  viewerId: string | null;
  cursor?: string;
  limit: number;
}

/**
 * Lists recipes, over-fetching by one for the keyset cursor.
 *
 * The `visibility` predicate here is an OPTIMISATION, not the guarantee: the
 * route re-checks every returned row through the policy layer. It is written to
 * be a strict subset of what `recipePolicy` allows, so the two can never
 * disagree in the dangerous direction.
 */
export async function listRecipeRows(
  db: BrewingDb,
  filters: RecipeListFilters,
): Promise<RecipeRow[]> {
  const values: unknown[] = [];
  const add = (v: unknown): string => `$${values.push(v)}`;

  const where: string[] = ['deleted_at IS NULL'];
  const viewer = add(filters.viewerId);
  where.push(`(visibility = 'public' OR author_id = ${viewer}::uuid)`);

  if (filters.authorId) where.push(`author_id = ${add(filters.authorId)}::uuid`);
  if (filters.coffeeProductId) {
    where.push(`coffee_product_id = ${add(filters.coffeeProductId)}::uuid`);
  }
  if (filters.method) where.push(`method = ${add(filters.method)}`);
  if (filters.visibility) where.push(`visibility = ${add(filters.visibility)}`);
  if (filters.isOfficial !== undefined) where.push(`is_official = ${add(filters.isOfficial)}`);
  if (filters.parentRecipeId) {
    where.push(`parent_recipe_id = ${add(filters.parentRecipeId)}::uuid`);
  }
  if (filters.cursor) {
    const key = decodeCursor(filters.cursor);
    where.push(`(created_at, id) < (${add(key.ts)}::timestamptz, ${add(key.id)}::uuid)`);
  }

  const res = await db.query<RecipeRow>(
    `SELECT ${RECIPE_COLUMNS} FROM recipes
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC, id DESC
     LIMIT ${add(filters.limit + 1)}`,
    values,
  );
  return res.rows;
}

// ---------------------------------------------------------------------------
// Recipes — writes
// ---------------------------------------------------------------------------

/** Everything a hash/diff compares — never the id, author or timestamps. */
function recipeContentOf(input: RecipeContent): Record<string, unknown> {
  return {
    title: input.title,
    coffee_product_id: input.coffee_product_id,
    coffee_style: input.coffee_style,
    method: input.method,
    brewer_model_id: input.brewer_model_id,
    grind: normaliseGrind(input.grind),
    params: normaliseParams(input.params),
  };
}

const diffableOf = (row: RecipeRow | RecipeContent): Parameters<typeof diffRecipes>[0] => ({
  title: row.title,
  coffee_product_id: row.coffee_product_id,
  coffee_style: row.coffee_style,
  method: row.method,
  brewer_model_id: row.brewer_model_id,
  grind: row.grind as unknown as Record<string, unknown>,
  params: row.params as unknown as Record<string, unknown>,
});

interface InsertRecipeExtras {
  parentRecipeId?: string | null;
  conflictOfRecipeId?: string | null;
  changedFields?: string[];
}

async function insertRecipeRow(
  db: BrewingDb,
  input: RecipeWriteInput,
  extras: InsertRecipeExtras = {},
): Promise<RecipeRow> {
  const grind = normaliseGrind(input.grind);
  const params = normaliseParams(input.params);
  try {
    const res = await db.query<RecipeRow>(
      `INSERT INTO recipes
         (id, author_id, title, coffee_product_id, coffee_style, method, brewer_model_id,
          grind, params, params_schema_version, parent_recipe_id, conflict_of_recipe_id,
          changed_fields, visibility)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7::uuid, $8::jsonb, $9::jsonb,
               $10, $11::uuid, $12::uuid, $13::text[], $14)
       RETURNING ${RECIPE_COLUMNS}`,
      [
        input.id,
        input.author_id,
        input.title,
        input.coffee_product_id,
        input.coffee_style,
        input.method,
        input.brewer_model_id,
        JSON.stringify(grind),
        JSON.stringify(params),
        PARAMS_SCHEMA_VERSION,
        extras.parentRecipeId ?? null,
        extras.conflictOfRecipeId ?? null,
        pgTextArray(extras.changedFields ?? []),
        input.visibility,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error('recipe insert returned no row');
    return row;
  } catch (err) {
    return translateWriteError(err, 'recipe');
  }
}

export async function createRecipe(db: BrewingDb, input: RecipeWriteInput): Promise<RecipeRow> {
  return insertRecipeRow(db, input);
}

/**
 * Idempotent PUT with CONFLICT-COPY semantics (EF §2.2, REC-03/REC-07).
 *
 * The four outcomes, in the order they are decided:
 *   created       — no row with that client-minted id yet.
 *   noop          — the stored content hashes identically. No UPDATE is issued,
 *                   so `updated_at` does not move and the row is not needlessly
 *                   republished to the user's other devices on the next pull.
 *   conflict_copy — the client based its edit on a version the server has since
 *                   moved past. The server NEVER overwrites: it writes the
 *                   client's version to a new "(conflicted copy)" row and hands
 *                   back both ids so the user can reconcile.
 *   updated       — otherwise; `version` increments.
 *
 * `author_id` is repeated in the UPDATE's WHERE clause as defence in depth. The
 * guarantee is the policy check the route already made; this is the seatbelt.
 */
export async function upsertRecipe(
  db: BrewingDb,
  input: RecipeWriteInput,
  baseVersion: number | undefined,
): Promise<{ result: SyncUpsertResult; row: RecipeRow; conflictCopy: RecipeRow | null }> {
  return withTransaction(db, async (tx) => {
    const existing = await getRecipeRow(tx, input.id);
    if (!existing) {
      const row = await insertRecipeRow(tx, input);
      return {
        result: { id: row.id, applied: 'created' as const, updated_at: iso(row.updated_at) },
        row,
        conflictCopy: null,
      };
    }

    const incoming = recipeContentOf(input);
    if (bodyHash(recipeContentOf(existing)) === bodyHash(incoming)) {
      return {
        result: { id: existing.id, applied: 'noop' as const, updated_at: iso(existing.updated_at) },
        row: existing,
        conflictCopy: null,
      };
    }

    if (baseVersion !== undefined && baseVersion !== existing.version) {
      const copy = await insertRecipeRow(
        tx,
        {
          ...input,
          id: crypto.randomUUID(),
          title: conflictTitle(input.title),
          // A conflicted copy is never published on the user's behalf.
          visibility: 'private',
        },
        {
          conflictOfRecipeId: existing.id,
          changedFields: diffRecipes(diffableOf(existing), diffableOf(input)),
        },
      );
      return {
        result: {
          id: existing.id,
          applied: 'conflict_copy' as const,
          conflict_copy_id: copy.id,
          updated_at: iso(existing.updated_at),
        },
        row: existing,
        conflictCopy: copy,
      };
    }

    const row = await updateRecipeRow(tx, existing, input);
    return {
      result: { id: row.id, applied: 'updated' as const, updated_at: iso(row.updated_at) },
      row,
      conflictCopy: null,
    };
  });
}

const CONFLICT_SUFFIX = ' (conflicted copy)';

function conflictTitle(title: string): string {
  const suffixed = `${title}${CONFLICT_SUFFIX}`;
  return suffixed.length <= 200 ? suffixed : `${title.slice(0, 200 - CONFLICT_SUFFIX.length)}${CONFLICT_SUFFIX}`;
}

async function updateRecipeRow(
  db: BrewingDb,
  existing: RecipeRow,
  input: RecipeContent & { visibility?: RecipeVisibility },
): Promise<RecipeRow> {
  const grind = normaliseGrind(input.grind);
  const params = normaliseParams(input.params);
  // A fork keeps its lineage AND keeps its diff honest as it is edited: the
  // changed_fields of a fork always describe the fork's CURRENT distance from
  // its parent, not its distance on the day it was created (§6.6).
  const changedFields =
    existing.parent_recipe_id !== null
      ? await recomputeForkDiff(db, existing.parent_recipe_id, { ...input, method: input.method })
      : (existing.changed_fields ?? []);

  try {
    const res = await db.query<RecipeRow>(
      `UPDATE recipes
          SET title = $3, coffee_product_id = $4::uuid, coffee_style = $5, method = $6,
              brewer_model_id = $7::uuid, grind = $8::jsonb, params = $9::jsonb,
              params_schema_version = $10, visibility = coalesce($11, visibility),
              changed_fields = $12::text[], version = version + 1
        WHERE id = $1::uuid AND author_id = $2::uuid
        RETURNING ${RECIPE_COLUMNS}`,
      [
        existing.id,
        existing.author_id,
        input.title,
        input.coffee_product_id,
        input.coffee_style,
        input.method,
        input.brewer_model_id,
        JSON.stringify(grind),
        JSON.stringify(params),
        PARAMS_SCHEMA_VERSION,
        input.visibility ?? null,
        pgTextArray(changedFields),
      ],
    );
    const row = res.rows[0];
    if (!row) throw notFound('Recipe not found.');
    return row;
  } catch (err) {
    return translateWriteError(err, 'recipe');
  }
}

async function recomputeForkDiff(
  db: BrewingDb,
  parentId: string,
  content: RecipeContent,
): Promise<string[]> {
  const parent = await getRecipeRow(db, parentId);
  if (!parent) return [];
  return diffRecipes(diffableOf(parent), diffableOf(content));
}

/** PATCH: merges the patch over the stored row, then goes through the same path. */
export async function patchRecipe(
  db: BrewingDb,
  existing: RecipeRow,
  patch: Partial<RecipeContent> & { visibility?: RecipeVisibility },
): Promise<RecipeRow> {
  return updateRecipeRow(db, existing, {
    title: patch.title ?? existing.title,
    coffee_product_id:
      patch.coffee_product_id !== undefined ? patch.coffee_product_id : existing.coffee_product_id,
    coffee_style: patch.coffee_style !== undefined ? patch.coffee_style : existing.coffee_style,
    method: patch.method ?? existing.method,
    brewer_model_id:
      patch.brewer_model_id !== undefined ? patch.brewer_model_id : existing.brewer_model_id,
    grind: patch.grind ?? existing.grind,
    params: patch.params ?? existing.params,
    ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
  });
}

/**
 * Fork (§6.6): a copy that carries `parent_recipe_id` forever and stores a real
 * diff of what the forker changed. Attribution is permanent — the parent's
 * ON DELETE RESTRICT means the database itself refuses to break the chain.
 */
export async function forkRecipe(
  db: BrewingDb,
  parent: RecipeRow,
  input: RecipeWriteInput,
): Promise<RecipeRow> {
  const changedFields = diffRecipes(diffableOf(parent), diffableOf(input));
  return insertRecipeRow(db, input, { parentRecipeId: parent.id, changedFields });
}

export async function softDeleteRecipe(db: BrewingDb, id: string): Promise<void> {
  await db.query(`UPDATE recipes SET deleted_at = now() WHERE id = $1::uuid AND deleted_at IS NULL`, [
    id,
  ]);
}

/** Attribution chain for the "forked from @anna's recipe, 2 changes" line. */
export async function getRecipeLineage(
  db: BrewingDb,
  id: string,
): Promise<{ id: string; title: string; author_id: string; visibility: RecipeVisibility } | null> {
  const res = await db.query<{
    id: string;
    title: string;
    author_id: string;
    visibility: RecipeVisibility;
  }>(
    `SELECT p.id, p.title, p.author_id, p.visibility
       FROM recipes r JOIN recipes p ON p.id = r.parent_recipe_id
      WHERE r.id = $1::uuid`,
    [id],
  );
  return res.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Recipe reviews
// ---------------------------------------------------------------------------

export async function upsertRecipeReview(
  db: BrewingDb,
  input: { recipe_id: string; user_id: string; rating: number; body: string | null },
): Promise<RecipeReview> {
  try {
    const res = await db.query<{
      id: string;
      recipe_id: string;
      user_id: string;
      rating: number;
      body: string | null;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `INSERT INTO recipe_reviews (recipe_id, user_id, rating, body)
       VALUES ($1::uuid, $2::uuid, $3, $4)
       ON CONFLICT (recipe_id, user_id)
         DO UPDATE SET rating = EXCLUDED.rating, body = EXCLUDED.body
       RETURNING id, recipe_id, user_id, rating, body, created_at, updated_at`,
      [input.recipe_id, input.user_id, input.rating, input.body],
    );
    const row = res.rows[0];
    if (!row) throw new Error('review upsert returned no row');
    return { ...row, created_at: iso(row.created_at), updated_at: iso(row.updated_at) };
  } catch (err) {
    return translateWriteError(err, 'recipe review');
  }
}

export async function listRecipeReviews(db: BrewingDb, recipeId: string): Promise<RecipeReview[]> {
  const res = await db.query<{
    id: string;
    recipe_id: string;
    user_id: string;
    rating: number;
    body: string | null;
    created_at: Date | string;
    updated_at: Date | string;
  }>(
    `SELECT id, recipe_id, user_id, rating, body, created_at, updated_at
       FROM recipe_reviews WHERE recipe_id = $1::uuid ORDER BY created_at DESC LIMIT 100`,
    [recipeId],
  );
  return res.rows.map((r) => ({ ...r, created_at: iso(r.created_at), updated_at: iso(r.updated_at) }));
}

// ---------------------------------------------------------------------------
// Brew sessions
// ---------------------------------------------------------------------------

export async function findBrewSessionResource(
  db: BrewingDb,
  id: string,
): Promise<BrewSessionResource | null> {
  const res = await db.query<{ id: string; user_id: string; deleted_at: Date | string | null }>(
    `SELECT id, user_id, deleted_at FROM brew_sessions WHERE id = $1::uuid`,
    [id],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { id: row.id, userId: row.user_id, deleted: row.deleted_at !== null };
}

export async function getBrewSessionRow(
  db: BrewingDb,
  id: string,
): Promise<BrewSessionRow | null> {
  const res = await db.query<BrewSessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM brew_sessions WHERE id = $1::uuid`,
    [id],
  );
  return res.rows[0] ?? null;
}

export interface BrewListFilters {
  userId: string;
  coffeeProductId?: string;
  recipeId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit: number;
}

export async function listBrewSessionRows(
  db: BrewingDb,
  filters: BrewListFilters,
): Promise<BrewSessionRow[]> {
  const values: unknown[] = [];
  const add = (v: unknown): string => `$${values.push(v)}`;

  const where = [`user_id = ${add(filters.userId)}::uuid`, 'deleted_at IS NULL'];
  if (filters.coffeeProductId) {
    where.push(`coffee_product_id = ${add(filters.coffeeProductId)}::uuid`);
  }
  if (filters.recipeId) where.push(`recipe_id = ${add(filters.recipeId)}::uuid`);
  if (filters.from) where.push(`brewed_at >= ${add(filters.from)}::timestamptz`);
  if (filters.to) where.push(`brewed_at <= ${add(filters.to)}::timestamptz`);
  if (filters.cursor) {
    const key = decodeCursor(filters.cursor);
    where.push(`(brewed_at, id) < (${add(key.ts)}::timestamptz, ${add(key.id)}::uuid)`);
  }

  const res = await db.query<BrewSessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM brew_sessions
      WHERE ${where.join(' AND ')}
      ORDER BY brewed_at DESC, id DESC
      LIMIT ${add(filters.limit + 1)}`,
    values,
  );
  return res.rows;
}

/**
 * Resolves the input into the exact record that will be written, so the
 * idempotency hash is computed over the SAME values the row ends up holding.
 * Only `brewed_at` needs resolving: an omitted one means "unchanged" on an
 * existing row and "now" on a new one. Defaulting it to `now()` unconditionally
 * would make every retry of an unchanged body look like an edit.
 */
function resolveSession(
  input: BrewSessionWriteInput,
  existing: BrewSessionRow | null,
): BrewSessionWriteInput & { brewed_at: string } {
  const brewed_at =
    input.brewed_at ?? (existing ? iso(existing.brewed_at) : new Date().toISOString());
  return { ...input, brewed_at };
}

/** Content that participates in the idempotency hash — never server-set fields. */
function sessionContentOf(
  input: BrewSessionWriteInput & { brewed_at: string },
  changedFields: string[],
) {
  return {
    recipe_id: input.recipe_id,
    coffee_product_id: input.coffee_product_id,
    roast_batch_id: input.roast_batch_id,
    brewer_model_id: input.brewer_model_id,
    grinder_model_id: input.grinder_model_id,
    grind: normaliseGrind(input.grind),
    params: normaliseParams(input.params),
    water: input.water,
    taste: input.taste,
    measurements: input.measurements,
    rating: input.rating,
    changed_fields: [...changedFields].sort(),
    source: input.source,
    photo_media_id: input.photo_media_id,
    brewed_at: new Date(input.brewed_at).toISOString(),
  };
}

const sessionDiffable = (
  row: Pick<
    BrewSessionRow,
    | 'recipe_id'
    | 'coffee_product_id'
    | 'roast_batch_id'
    | 'brewer_model_id'
    | 'grinder_model_id'
    | 'rating'
    | 'grind'
    | 'params'
    | 'water'
  >,
): DiffableSession => ({
  recipe_id: row.recipe_id,
  coffee_product_id: row.coffee_product_id,
  roast_batch_id: row.roast_batch_id,
  brewer_model_id: row.brewer_model_id,
  grinder_model_id: row.grinder_model_id,
  rating: row.rating,
  grind: row.grind as unknown as Record<string, unknown>,
  params: row.params as unknown as Record<string, unknown>,
  water: (row.water as unknown as Record<string, unknown>) ?? null,
});

/**
 * The user's previous session for this coffee — the baseline the server diffs
 * against when the client did not tell us what it changed.
 */
async function findPreviousSession(
  db: BrewingDb,
  input: BrewSessionWriteInput & { brewed_at: string },
): Promise<BrewSessionRow | null> {
  const res = await db.query<BrewSessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM brew_sessions
      WHERE user_id = $1::uuid
        AND coffee_product_id IS NOT DISTINCT FROM $2::uuid
        AND id <> $3::uuid
        AND deleted_at IS NULL
        AND brewed_at <= $4::timestamptz
      ORDER BY brewed_at DESC, id DESC
      LIMIT 1`,
    [input.user_id, input.coffee_product_id, input.id, input.brewed_at],
  );
  return res.rows[0] ?? null;
}

export interface BrewUpsertOutcome {
  result: SyncUpsertResult;
  row: BrewSessionRow;
  /** Set when this write produced a new grind-conversion data point (GC-02). */
  grindObservation: GrindObservation | null;
}

/**
 * Idempotent PUT for a brew session (EF §2.2, BREW-04's server half).
 *
 * Sessions are single-author and low-conflict, so the resolution rule is
 * LAST-WRITE-WINS on `updated_at` — not conflict-copy. Concretely:
 *   * same body → `noop`, no UPDATE, `updated_at` unchanged;
 *   * client payload older than the stored row → `noop`, the server copy stands
 *     (a queued offline edit must never resurrect over a newer one);
 *   * otherwise → `updated`.
 */
export async function upsertBrewSession(
  db: BrewingDb,
  input: BrewSessionWriteInput,
): Promise<BrewUpsertOutcome> {
  return withTransaction(db, async (tx) => {
    const existing = await getBrewSessionRow(tx, input.id);
    const resolved = resolveSession(input, existing);

    let changedFields = resolved.changed_fields;
    if (changedFields === null) {
      const previous = await findPreviousSession(tx, resolved);
      changedFields = previous
        ? diffSessions(sessionDiffable(previous), sessionDiffable(toDiffableInput(resolved)))
        : [];
    }

    const hash = bodyHash(sessionContentOf(resolved, changedFields));

    if (existing) {
      if (existing.body_hash === hash) {
        return {
          result: {
            id: existing.id,
            applied: 'noop' as const,
            updated_at: iso(existing.updated_at),
          },
          row: existing,
          grindObservation: null,
        };
      }
      if (
        resolved.client_updated_at !== null &&
        Date.parse(resolved.client_updated_at) < Date.parse(iso(existing.updated_at))
      ) {
        // Last-write-wins: the server already holds a newer revision.
        return {
          result: {
            id: existing.id,
            applied: 'noop' as const,
            updated_at: iso(existing.updated_at),
          },
          row: existing,
          grindObservation: null,
        };
      }
      const row = await writeSession(tx, resolved, changedFields, hash, 'update');
      const grindObservation = await captureGrindConversion(tx, row);
      return {
        result: { id: row.id, applied: 'updated' as const, updated_at: iso(row.updated_at) },
        row,
        grindObservation,
      };
    }

    const row = await writeSession(tx, resolved, changedFields, hash, 'insert');
    const grindObservation = await captureGrindConversion(tx, row);
    return {
      result: { id: row.id, applied: 'created' as const, updated_at: iso(row.updated_at) },
      row,
      grindObservation,
    };
  });
}

const toDiffableInput = (input: BrewSessionWriteInput & { brewed_at: string }) => ({
  recipe_id: input.recipe_id,
  coffee_product_id: input.coffee_product_id,
  roast_batch_id: input.roast_batch_id,
  brewer_model_id: input.brewer_model_id,
  grinder_model_id: input.grinder_model_id,
  rating: input.rating,
  grind: normaliseGrind(input.grind),
  params: normaliseParams(input.params),
  water: input.water,
});

async function writeSession(
  db: BrewingDb,
  input: BrewSessionWriteInput & { brewed_at: string },
  changedFields: string[],
  hash: string,
  mode: 'insert' | 'update',
): Promise<BrewSessionRow> {
  const grind = normaliseGrind(input.grind);
  const params = normaliseParams(input.params);
  const values = [
    input.id,
    input.user_id,
    input.recipe_id,
    input.coffee_product_id,
    input.roast_batch_id,
    input.brewer_model_id,
    // The grinder is carried both as a column (for joins and indexes) and inside
    // the grind object (which is the shape §6.4 mandates). The column follows
    // the object when the client only filled one of them.
    input.grinder_model_id ?? grind.equipment_model_id,
    JSON.stringify(grind),
    JSON.stringify(params),
    PARAMS_SCHEMA_VERSION,
    input.water === null ? null : JSON.stringify(input.water),
    input.taste === null ? null : JSON.stringify(input.taste),
    input.measurements === null ? null : JSON.stringify(input.measurements),
    input.rating,
    pgTextArray(changedFields),
    input.source,
    input.photo_media_id,
    input.brewed_at,
    hash,
  ];

  try {
    if (mode === 'insert') {
      const res = await db.query<BrewSessionRow>(
        `INSERT INTO brew_sessions
           (id, user_id, recipe_id, coffee_product_id, roast_batch_id, brewer_model_id,
            grinder_model_id, grind, params, params_schema_version, water, taste,
            measurements, rating, changed_fields, source, photo_media_id, brewed_at, body_hash)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid,
                 $8::jsonb, $9::jsonb, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14,
                 $15::text[], $16, $17::uuid, $18::timestamptz, $19)
         RETURNING ${SESSION_COLUMNS}`,
        values,
      );
      const row = res.rows[0];
      if (!row) throw new Error('brew session insert returned no row');
      return row;
    }

    const res = await db.query<BrewSessionRow>(
      `UPDATE brew_sessions
          SET recipe_id = $3::uuid, coffee_product_id = $4::uuid, roast_batch_id = $5::uuid,
              brewer_model_id = $6::uuid, grinder_model_id = $7::uuid, grind = $8::jsonb,
              params = $9::jsonb, params_schema_version = $10, water = $11::jsonb,
              taste = $12::jsonb, measurements = $13::jsonb, rating = $14,
              changed_fields = $15::text[], source = $16, photo_media_id = $17::uuid,
              brewed_at = $18::timestamptz, body_hash = $19, deleted_at = NULL
        WHERE id = $1::uuid AND user_id = $2::uuid
        RETURNING ${SESSION_COLUMNS}`,
      values,
    );
    const row = res.rows[0];
    if (!row) throw notFound('Brew session not found.');
    return row;
  } catch (err) {
    return translateWriteError(err, 'brew session');
  }
}

export async function softDeleteBrewSession(db: BrewingDb, id: string): Promise<void> {
  await db.query(
    `UPDATE brew_sessions SET deleted_at = now() WHERE id = $1::uuid AND deleted_at IS NULL`,
    [id],
  );
}

// ---------------------------------------------------------------------------
// Grind conversion capture (GC-02, risk #9)
// ---------------------------------------------------------------------------

export interface GrindObservation {
  from_model_id: string;
  from_setting: string;
  to_model_id: string;
  to_setting: string;
  brew_session_id: string;
  grind_conversion_id: string;
  data_points: number;
}

/** Honest confidence: it grows with evidence and never reaches certainty. */
const CONFIDENCE_SQL = `LEAST(0.9, 0.35 + 0.05 * (data_points + 1))`;
const INITIAL_CONFIDENCE = 0.4;

/**
 * Records a (grinder A, setting) → (grinder B, setting) data point — but ONLY
 * when every one of these holds (§6.4 point 3, GC-02, risk #9):
 *
 *   1. the session was brewed from a recipe that is a FORK of another recipe;
 *   2. the user rated that brew GOOD (see `isRatedGood` — an explicit positive
 *      verdict, or 4+ stars with no contradicting verdict);
 *   3. the grinder actually differs from the parent recipe's;
 *   4. both sides have a concrete setting to record.
 *
 * A fork the user never brewed, or brewed and disliked, contributes NOTHING.
 * That is the entire point: risk #9 is "the conversion dataset fills up with
 * guesses and becomes worthless".
 *
 * `brew_grind_observations.brew_session_id` is UNIQUE, so re-syncing or editing
 * the same session can never inflate `data_points` a second time.
 */
export async function captureGrindConversion(
  db: BrewingDb,
  session: BrewSessionRow,
): Promise<GrindObservation | null> {
  if (!isRatedGood(session.taste, session.rating)) return null;
  if (!session.recipe_id) return null;

  const parentRes = await db.query<{ parent_id: string; parent_grind: GrindSetting }>(
    `SELECT p.id AS parent_id, p.grind AS parent_grind
       FROM recipes r JOIN recipes p ON p.id = r.parent_recipe_id
      WHERE r.id = $1::uuid`,
    [session.recipe_id],
  );
  const parent = parentRes.rows[0];
  if (!parent) return null; // not a fork → nothing to convert between

  const fromModel = parent.parent_grind?.equipment_model_id ?? null;
  const fromSetting = parent.parent_grind?.setting ?? null;
  const toModel = session.grind?.equipment_model_id ?? session.grinder_model_id;
  const toSetting = session.grind?.setting ?? null;

  if (!fromModel || !fromSetting || !toModel || !toSetting) return null;
  if (fromModel === toModel) return null; // same grinder → not a conversion

  // 1. Ensure the conversion row exists. DO NOTHING (not DO UPDATE) so the
  //    counter is only touched once we know the observation is genuinely new.
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO grind_conversions
       (from_model_id, from_setting, to_model_id, to_setting, source, confidence, data_points)
     VALUES ($1::uuid, $2, $3::uuid, $4, 'user_confirmed', $5, 1)
     ON CONFLICT (from_model_id, from_setting, to_model_id, to_setting) DO NOTHING
     RETURNING id`,
    [fromModel, fromSetting, toModel, toSetting, INITIAL_CONFIDENCE],
  );
  let conversionId = inserted.rows[0]?.id ?? null;
  const conversionIsNew = conversionId !== null;
  if (!conversionId) {
    const found = await db.query<{ id: string }>(
      `SELECT id FROM grind_conversions
        WHERE from_model_id = $1::uuid AND from_setting = $2
          AND to_model_id = $3::uuid AND to_setting = $4`,
      [fromModel, fromSetting, toModel, toSetting],
    );
    conversionId = found.rows[0]?.id ?? null;
  }
  if (!conversionId) return null;

  // 2. Claim the observation. UNIQUE(brew_session_id) makes this the idempotency
  //    gate for the counter below.
  const claimed = await db.query<{ id: string }>(
    `INSERT INTO brew_grind_observations
       (brew_session_id, recipe_id, parent_recipe_id, grind_conversion_id,
        from_model_id, from_setting, to_model_id, to_setting)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7::uuid, $8)
     ON CONFLICT (brew_session_id) DO NOTHING
     RETURNING id`,
    [
      session.id,
      session.recipe_id,
      parent.parent_id,
      conversionId,
      fromModel,
      fromSetting,
      toModel,
      toSetting,
    ],
  );
  if (claimed.rows.length === 0) return null; // already counted

  // 3. Count it. A row we just created already stands at data_points = 1.
  const counted = await db.query<{ data_points: number }>(
    conversionIsNew
      ? `SELECT data_points FROM grind_conversions WHERE id = $1::uuid`
      : `UPDATE grind_conversions
            SET data_points = data_points + 1,
                source = 'user_confirmed',
                confidence = ${CONFIDENCE_SQL}
          WHERE id = $1::uuid
          RETURNING data_points`,
    [conversionId],
  );

  return {
    from_model_id: fromModel,
    from_setting: fromSetting,
    to_model_id: toModel,
    to_setting: toSetting,
    brew_session_id: session.id,
    grind_conversion_id: conversionId,
    data_points: Number(counted.rows[0]?.data_points ?? 1),
  };
}

// ---------------------------------------------------------------------------
// Prefill (the 15-second bar) — ONE query, three fallbacks
// ---------------------------------------------------------------------------

export interface PrefillRow {
  prio: number;
  basis: 'last_session' | 'official_recipe' | 'community_recipe';
  last_session_id: string | null;
  recipe_id: string | null;
  coffee_product_id: string | null;
  brewer_model_id: string | null;
  grinder_model_id: string | null;
  grind: GrindSetting;
  params: BrewParams;
}

/**
 * Resolves the prefill payload in a SINGLE round trip (logger UX §5: "the screen
 * is interactive before any network response" — the server side of that promise
 * is that this never becomes three sequential queries).
 *
 * Priority: the user's own last brew of this coffee → an official recipe for it
 * → a community recipe, both preferring the brewer the user last used. The
 * caller supplies the defaults if this returns nothing.
 */
export async function findPrefill(
  db: BrewingDb,
  opts: { userId: string; coffeeProductId: string | null; method: string | null },
): Promise<PrefillRow | null> {
  const res = await db.query<PrefillRow>(
    `WITH recent AS (
       SELECT brewer_model_id, grinder_model_id
         FROM brew_sessions
        WHERE user_id = $1::uuid AND deleted_at IS NULL
        ORDER BY brewed_at DESC, id DESC
        LIMIT 1
     ),
     last_session AS (
       SELECT id, recipe_id, coffee_product_id, brewer_model_id, grinder_model_id, grind, params
         FROM brew_sessions
        WHERE user_id = $1::uuid
          AND deleted_at IS NULL
          AND ($2::uuid IS NULL OR coffee_product_id = $2::uuid)
          AND ($3::text IS NULL OR params->>'method' = $3::text)
        ORDER BY brewed_at DESC, id DESC
        LIMIT 1
     ),
     recipe_pick AS (
       SELECT r.id, r.coffee_product_id, r.brewer_model_id, r.grind, r.params, r.is_official
         FROM recipes r
        WHERE r.deleted_at IS NULL
          AND r.visibility = 'public'
          AND ($2::uuid IS NULL OR r.coffee_product_id = $2::uuid)
          AND ($3::text IS NULL OR r.method = $3::text)
        ORDER BY r.is_official DESC,
                 coalesce(r.brewer_model_id = (SELECT brewer_model_id FROM recent), false) DESC,
                 r.created_at DESC
        LIMIT 1
     )
     SELECT 1 AS prio, 'last_session' AS basis, ls.id::text AS last_session_id,
            ls.recipe_id, ls.coffee_product_id, ls.brewer_model_id, ls.grinder_model_id,
            ls.grind, ls.params
       FROM last_session ls
     UNION ALL
     SELECT 2 AS prio,
            CASE WHEN rp.is_official THEN 'official_recipe' ELSE 'community_recipe' END AS basis,
            NULL AS last_session_id, rp.id AS recipe_id, rp.coffee_product_id,
            coalesce(rp.brewer_model_id, (SELECT brewer_model_id FROM recent)) AS brewer_model_id,
            (SELECT grinder_model_id FROM recent) AS grinder_model_id,
            rp.grind, rp.params
       FROM recipe_pick rp
     ORDER BY prio
     LIMIT 1`,
    [opts.userId, opts.coffeeProductId, opts.method],
  );
  return res.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Sync (BREW-05)
// ---------------------------------------------------------------------------

export interface SyncRow<T> {
  id: string;
  updated_at: Date | string;
  deleted: boolean;
  row: T;
}

/**
 * Changed rows for ONE user, ordered `(updated_at ASC, id ASC)` so a pull can be
 * resumed exactly. Soft-deleted rows are returned as tombstones — a client that
 * never learns about a deletion keeps showing a brew that no longer exists.
 *
 * The `user_id`/`author_id` predicate is not the security boundary: the route
 * re-checks every row it is about to return through `can(actor, 'read', ...)`.
 */
export async function listSessionChanges(
  db: BrewingDb,
  opts: { userId: string; since: { ts: string; id: string } | null; limit: number },
): Promise<SyncRow<BrewSessionRow>[]> {
  const res = await db.query<BrewSessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM brew_sessions
      WHERE user_id = $1::uuid
        AND ($2::timestamptz IS NULL
             OR (updated_at, id) > ($2::timestamptz, $3::uuid))
      ORDER BY updated_at ASC, id ASC
      LIMIT $4`,
    [opts.userId, opts.since?.ts ?? null, opts.since?.id ?? null, opts.limit + 1],
  );
  return res.rows.map((row) => ({
    id: row.id,
    updated_at: row.updated_at,
    deleted: row.deleted_at !== null,
    row,
  }));
}

export async function listRecipeChanges(
  db: BrewingDb,
  opts: { userId: string; since: { ts: string; id: string } | null; limit: number },
): Promise<SyncRow<RecipeRow>[]> {
  const res = await db.query<RecipeRow>(
    `SELECT ${RECIPE_COLUMNS} FROM recipes
      WHERE author_id = $1::uuid
        AND ($2::timestamptz IS NULL
             OR (updated_at, id) > ($2::timestamptz, $3::uuid))
      ORDER BY updated_at ASC, id ASC
      LIMIT $4`,
    [opts.userId, opts.since?.ts ?? null, opts.since?.id ?? null, opts.limit + 1],
  );
  return res.rows.map((row) => ({
    id: row.id,
    updated_at: row.updated_at,
    deleted: row.deleted_at !== null,
    row,
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Postgres text[] literal. Built here rather than passed as a JS array so the
 * same code works against `pg` and PGlite, whose array binding differs.
 * Values are escaped, never interpolated raw.
 */
export function pgTextArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/(["\\])/g, '\\$1')}"`).join(',')}}`;
}

// ---------------------------------------------------------------------------
// Row → DTO
// ---------------------------------------------------------------------------

export function toRecipe(row: RecipeRow): Recipe {
  return {
    id: row.id,
    author_id: row.author_id,
    title: row.title,
    coffee_product_id: row.coffee_product_id,
    coffee_style: row.coffee_style,
    method: row.method,
    brewer_model_id: row.brewer_model_id,
    grind: row.grind,
    params: row.params,
    params_schema_version: row.params_schema_version,
    parent_recipe_id: row.parent_recipe_id,
    changed_fields: row.changed_fields ?? [],
    version: row.version,
    visibility: row.visibility,
    is_official: row.is_official,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export function toBrewSession(row: BrewSessionRow): BrewSession {
  return {
    id: row.id,
    user_id: row.user_id,
    recipe_id: row.recipe_id,
    coffee_product_id: row.coffee_product_id,
    roast_batch_id: row.roast_batch_id,
    brewer_model_id: row.brewer_model_id,
    grinder_model_id: row.grinder_model_id,
    grind: row.grind,
    params: row.params,
    params_schema_version: row.params_schema_version,
    ...(row.water !== null ? { water: row.water } : {}),
    ...(row.taste !== null ? { taste: row.taste } : {}),
    ...(row.measurements !== null ? { measurements: row.measurements } : {}),
    ...(row.rating !== null ? { rating: row.rating } : {}),
    changed_fields: row.changed_fields ?? [],
    source: row.source,
    photo_media_id: row.photo_media_id,
    brewed_at: iso(row.brewed_at),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}
