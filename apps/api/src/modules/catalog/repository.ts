/**
 * Catalog repository — the ONLY place in the module that writes SQL.
 *
 * Rules (EF §3.3, EF §1.2):
 *  - Parameterised queries only. User input never reaches the SQL string; it is
 *    collected by `Params` and bound as `$n`. The only strings concatenated into
 *    a statement are fixed, developer-authored fragments in this file.
 *  - Only catalog-owned tables are touched: roasters, origins, farms,
 *    coffee_lots, coffee_products, roast_batches, equipment_brands,
 *    equipment_models, grind_conversions (db/migrations/0003_catalog.sql).
 *
 * Route handlers never see rows — they receive the DTOs from `./types.js`.
 */

import { query as poolQuery } from '../../lib/db.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { mediaUrl } from '../media/index.js';
import { decodeCursor, paginate } from './cursor.js';
import { escapeLike, isUuid, slugify } from './text.js';
import type {
  AutocompleteItem,
  CoffeeDetail,
  CoffeeLot,
  CoffeeStatus,
  CoffeeSummary,
  EquipmentBrandRef,
  EquipmentCategory,
  EquipmentDetail,
  EquipmentSummary,
  GrindConversion,
  GrindConversionSource,
  GrindScaleType,
  IntendedUse,
  LotProcess,
  OriginSummary,
  Page,
  RoastBatch,
  RoastLevel,
  RoasterDetail,
  RoasterSummary,
  SearchHit,
} from './types.js';

// ---------------------------------------------------------------------------
// Database seam
// ---------------------------------------------------------------------------

export interface QueryResultLike<T> {
  rows: T[];
}

/**
 * The narrow slice of a Postgres client the catalog needs. Production wires the
 * shared pool (`lib/db.ts`); tests wire an in-process PGlite instance. Nothing
 * else about the driver is assumed.
 */
export interface CatalogDb {
  query<T>(text: string, params?: readonly unknown[]): Promise<QueryResultLike<T>>;
}

/** Default seam: the shared application pool. */
export const defaultCatalogDb: CatalogDb = {
  query: async <T>(text: string, params: readonly unknown[] = []) =>
    poolQuery(text, params) as unknown as Promise<QueryResultLike<T>>,
};

/** Accumulates bound parameters and hands back the `$n` placeholder for each. */
class Params {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

// ---------------------------------------------------------------------------
// Postgres error translation
// ---------------------------------------------------------------------------

interface PgErrorLike {
  code?: string;
  constraint?: string;
  detail?: string;
  message?: string;
}

const pgError = (err: unknown): PgErrorLike =>
  typeof err === 'object' && err !== null ? (err as PgErrorLike) : {};

/**
 * Turns database constraint failures into the right HTTP error.
 * 23505 unique_violation → 409 (slug already taken), 23503 foreign_key_violation
 * and 23514 check_violation → 400 (the client sent something the domain rejects).
 */
export function translateWriteError(err: unknown, subject: string): never {
  const { code, constraint, message } = pgError(err);
  if (code === '23505') {
    throw conflict(`A ${subject} with that slug already exists.`, { constraint });
  }
  if (code === '23503') {
    throw badRequest(`Referenced entity does not exist.`, { constraint });
  }
  if (code === '23514') {
    throw badRequest(`Value rejected by the ${subject} domain rules.`, { constraint });
  }
  if (code === '22P02') {
    throw badRequest('Malformed identifier.', { message });
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Row → DTO mappers
// ---------------------------------------------------------------------------

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : String(value);

const dateOnly = (value: Date | string): string =>
  value instanceof Date ? (value.toISOString().split('T')[0] ?? '') : String(value).slice(0, 10);

interface CoffeeRow {
  id: string;
  slug: string;
  name: string;
  image_key: string | null;
  image_thumbnail_key: string | null;
  roast_level: RoastLevel;
  intended_use: IntendedUse;
  tasting_notes: string[] | null;
  status: CoffeeStatus;
  created_at: Date | string;
  updated_at: Date | string;
  roaster_id: string;
  roaster_slug: string;
  roaster_name: string;
  lot_id: string | null;
  process: LotProcess | null;
  process_detail: string | null;
  varietals: string[] | null;
  altitude_masl: number | null;
  harvest_period: string | null;
  origin_id: string | null;
  origin_country: string | null;
  origin_region: string | null;
  farm_id: string | null;
  farm_name: string | null;
  farm_story: string | null;
}

/**
 * Absolute URLs on the media origin. Built through media's published helper so
 * the URL shape lives in exactly one module; null when the entity has no
 * artwork, which every client renders as its text-only state.
 */
function toImage(
  key: string | null | undefined,
  thumbnailKey: string | null | undefined,
): { url: string; thumbnail_url: string } | null {
  if (!key) return null;
  return { url: mediaUrl(key), thumbnail_url: mediaUrl(thumbnailKey ?? key) };
}

function toCoffeeSummary(row: CoffeeRow): CoffeeSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    roast_level: row.roast_level,
    intended_use: row.intended_use,
    tasting_notes: row.tasting_notes ?? [],
    status: row.status,
    roaster: { id: row.roaster_id, slug: row.roaster_slug, name: row.roaster_name },
    origin:
      row.origin_id !== null
        ? { id: row.origin_id, country: row.origin_country ?? '', region: row.origin_region }
        : null,
    process: row.process,
    image: toImage(row.image_key, row.image_thumbnail_key),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

function toCoffeeLot(row: CoffeeRow): CoffeeLot | null {
  if (row.lot_id === null) return null;
  return {
    id: row.lot_id,
    process: row.process ?? 'washed',
    process_detail: row.process_detail,
    varietals: row.varietals ?? [],
    altitude_masl: row.altitude_masl,
    harvest_period: row.harvest_period,
    origin:
      row.origin_id !== null
        ? { id: row.origin_id, country: row.origin_country ?? '', region: row.origin_region }
        : null,
    farm:
      row.farm_id !== null
        ? { id: row.farm_id, name: row.farm_name ?? '', story: row.farm_story }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Shared SQL fragments (developer-authored constants — never user input)
// ---------------------------------------------------------------------------

const COFFEE_COLUMNS = `
  cp.id, cp.slug, cp.name, cp.roast_level, cp.intended_use, cp.tasting_notes,
  cp.status, cp.created_at, cp.updated_at,
  cpm.storage_key AS image_key, cpm.thumbnail_key AS image_thumbnail_key,
  r.id   AS roaster_id, r.slug AS roaster_slug, r.name AS roaster_name,
  cl.id  AS lot_id, cl.process, cl.process_detail, cl.varietals,
  cl.altitude_masl, cl.harvest_period,
  o.id   AS origin_id, o.country AS origin_country, o.region AS origin_region,
  f.id   AS farm_id, f.name AS farm_name, f.story AS farm_story`;

const COFFEE_FROM = `
  FROM coffee_products cp
  -- Cross-module read of media (documented boundary exception, as in admin):
  -- the alternative is an N+1 lookup per card. Writes still belong to media;
  -- URL construction goes through media's published mediaUrl().
  LEFT JOIN media cpm ON cpm.id = cp.image_media_id AND cpm.status = 'ready'
  JOIN roasters      r  ON r.id  = cp.roaster_id
  LEFT JOIN coffee_lots cl ON cl.id = cp.coffee_lot_id
  LEFT JOIN origins  o  ON o.id  = cl.origin_id
  LEFT JOIN farms    f  ON f.id  = cl.farm_id`;

/**
 * Full-text document for a coffee: the product, its roaster, its provenance and
 * its controlled vocabularies. Kept in one place so the search endpoint and any
 * future generated tsvector column stay in sync (see report: index request).
 */
const COFFEE_TSVECTOR = `
  to_tsvector('english',
    cp.name || ' ' || r.name || ' ' ||
    array_to_string(cp.tasting_notes, ' ') || ' ' ||
    cp.roast_level || ' ' || cp.intended_use || ' ' ||
    coalesce(cl.process, '') || ' ' || coalesce(cl.process_detail, '') || ' ' ||
    array_to_string(coalesce(cl.varietals, '{}'::text[]), ' ') || ' ' ||
    coalesce(o.country, '') || ' ' || coalesce(o.region, '') || ' ' ||
    coalesce(f.name, ''))`;

const ROASTER_TSVECTOR = `to_tsvector('english', r.name || ' ' || coalesce(r.location, ''))`;

const EQUIPMENT_TSVECTOR = `
  to_tsvector('english', eb.name || ' ' || em.name || ' ' || em.category)`;

// ---------------------------------------------------------------------------
// Coffees
// ---------------------------------------------------------------------------

export interface CoffeeListFilters {
  roaster?: string;
  origin?: string;
  process?: LotProcess;
  roast_level?: RoastLevel;
  intended_use?: IntendedUse;
  status?: CoffeeStatus;
  cursor?: string;
  limit: number;
}

export async function listCoffees(
  db: CatalogDb,
  filters: CoffeeListFilters,
): Promise<Page<CoffeeSummary>> {
  const p = new Params();
  const where: string[] = [];

  if (filters.roaster !== undefined) {
    // Roaster is referenced by slug (the public identifier) or by uuid.
    where.push(
      isUuid(filters.roaster)
        ? `r.id = ${p.add(filters.roaster)}::uuid`
        : `r.slug = ${p.add(filters.roaster)}`,
    );
  }
  if (filters.origin !== undefined) {
    // Accepts an origin uuid or a country name ("Ethiopia"), case-insensitive.
    where.push(
      isUuid(filters.origin)
        ? `o.id = ${p.add(filters.origin)}::uuid`
        : `lower(o.country) = lower(${p.add(filters.origin)})`,
    );
  }
  if (filters.process !== undefined) where.push(`cl.process = ${p.add(filters.process)}`);
  if (filters.roast_level !== undefined) {
    where.push(`cp.roast_level = ${p.add(filters.roast_level)}`);
  }
  if (filters.intended_use !== undefined) {
    where.push(`cp.intended_use = ${p.add(filters.intended_use)}`);
  }
  if (filters.status !== undefined) where.push(`cp.status = ${p.add(filters.status)}`);

  if (filters.cursor !== undefined) {
    const key = decodeCursor(filters.cursor);
    where.push(
      `(cp.created_at, cp.id) < (${p.add(key.created_at)}::timestamptz, ${p.add(key.id)}::uuid)`,
    );
  }

  const sql = `
    SELECT ${COFFEE_COLUMNS}
    ${COFFEE_FROM}
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY cp.created_at DESC, cp.id DESC
    LIMIT ${p.add(filters.limit + 1)}`;

  const res = await db.query<CoffeeRow>(sql, p.values);
  const page = paginate(res.rows, filters.limit);
  return { items: page.items.map(toCoffeeSummary), next_cursor: page.next_cursor };
}

export async function getCoffeeBySlug(db: CatalogDb, slug: string): Promise<CoffeeDetail> {
  return getCoffeeBy(db, 'cp.slug', slug);
}

/**
 * Id-keyed lookup. Rows elsewhere in the graph (a brew session, a recipe) store
 * `coffee_product_id`, not a slug, so callers holding an id had to guess a slug
 * or be handed one by the client — the AI module hit exactly this.
 */
export async function getCoffeeById(db: CatalogDb, id: string): Promise<CoffeeDetail> {
  if (!isUuid(id)) throw notFound('Coffee not found.');
  return getCoffeeBy(db, 'cp.id', id);
}

async function getCoffeeBy(
  db: CatalogDb,
  column: 'cp.slug' | 'cp.id',
  value: string,
): Promise<CoffeeDetail> {
  const res = await db.query<CoffeeRow>(
    // `column` is a closed union of literals, never caller-supplied text.
    `SELECT ${COFFEE_COLUMNS} ${COFFEE_FROM} WHERE ${column} = $1`,
    [value],
  );
  const row = res.rows[0];
  if (!row) throw notFound('Coffee not found.');

  const batches = await db.query<{ id: string; roast_date: Date | string }>(
    `SELECT id, roast_date FROM roast_batches
     WHERE coffee_product_id = $1
     ORDER BY roast_date DESC, id DESC`,
    [row.id],
  );

  const roast_batches: RoastBatch[] = batches.rows.map((b) => ({
    id: b.id,
    roast_date: dateOnly(b.roast_date),
  }));

  return { ...toCoffeeSummary(row), lot: toCoffeeLot(row), roast_batches };
}

// ---------------------------------------------------------------------------
// Roasters
// ---------------------------------------------------------------------------

interface RoasterRow {
  id: string;
  slug: string;
  name: string;
  location: string | null;
  verified: boolean;
  coffee_count: number;
  created_at: Date | string;
  updated_at: Date | string;
}

const toRoasterSummary = (row: RoasterRow): RoasterSummary => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  location: row.location,
  verified: row.verified,
  coffee_count: Number(row.coffee_count),
  created_at: iso(row.created_at),
  updated_at: iso(row.updated_at),
});

const ROASTER_SELECT = `
  SELECT r.id, r.slug, r.name, r.location, r.verified, r.created_at, r.updated_at,
         (SELECT count(*) FROM coffee_products cp WHERE cp.roaster_id = r.id)::int AS coffee_count
  FROM roasters r`;

export async function listRoasters(
  db: CatalogDb,
  opts: { verified?: boolean; cursor?: string; limit: number },
): Promise<Page<RoasterSummary>> {
  const p = new Params();
  const where: string[] = [];
  if (opts.verified !== undefined) where.push(`r.verified = ${p.add(opts.verified)}`);
  if (opts.cursor !== undefined) {
    const key = decodeCursor(opts.cursor);
    where.push(
      `(r.created_at, r.id) < (${p.add(key.created_at)}::timestamptz, ${p.add(key.id)}::uuid)`,
    );
  }

  const res = await db.query<RoasterRow>(
    `${ROASTER_SELECT}
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ${p.add(opts.limit + 1)}`,
    p.values,
  );
  const page = paginate(res.rows, opts.limit);
  return { items: page.items.map(toRoasterSummary), next_cursor: page.next_cursor };
}

export async function getRoasterBySlug(db: CatalogDb, slug: string): Promise<RoasterDetail> {
  const res = await db.query<RoasterRow>(`${ROASTER_SELECT} WHERE r.slug = $1`, [slug]);
  const row = res.rows[0];
  if (!row) throw notFound('Roaster not found.');

  const coffees = await db.query<CoffeeRow>(
    `SELECT ${COFFEE_COLUMNS} ${COFFEE_FROM}
     WHERE cp.roaster_id = $1
     ORDER BY cp.created_at DESC, cp.id DESC
     LIMIT 200`,
    [row.id],
  );

  return { ...toRoasterSummary(row), coffees: coffees.rows.map(toCoffeeSummary) };
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

interface EquipmentRow {
  id: string;
  slug: string;
  name: string;
  category: EquipmentCategory;
  grind_scale_type: GrindScaleType | null;
  specs: Record<string, unknown> | string | null;
  brand_id: string;
  brand_name: string;
  created_at: Date | string;
  updated_at: Date | string;
}

const toEquipmentSummary = (row: EquipmentRow): EquipmentSummary => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  category: row.category,
  grind_scale_type: row.grind_scale_type,
  brand: { id: row.brand_id, name: row.brand_name },
  created_at: iso(row.created_at),
  updated_at: iso(row.updated_at),
});

const parseSpecs = (specs: EquipmentRow['specs']): Record<string, unknown> => {
  if (specs === null) return {};
  if (typeof specs === 'string') {
    try {
      return JSON.parse(specs) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return specs;
};

const EQUIPMENT_SELECT = `
  SELECT em.id, em.slug, em.name, em.category, em.grind_scale_type, em.specs,
         em.created_at, em.updated_at,
         eb.id AS brand_id, eb.name AS brand_name
  FROM equipment_models em
  JOIN equipment_brands eb ON eb.id = em.brand_id`;

export async function listEquipment(
  db: CatalogDb,
  opts: { category?: EquipmentCategory; brand?: string; cursor?: string; limit: number },
): Promise<Page<EquipmentSummary>> {
  const p = new Params();
  const where: string[] = [];
  if (opts.category !== undefined) where.push(`em.category = ${p.add(opts.category)}`);
  if (opts.brand !== undefined) {
    where.push(
      isUuid(opts.brand)
        ? `eb.id = ${p.add(opts.brand)}::uuid`
        : `lower(eb.name) = lower(${p.add(opts.brand)})`,
    );
  }
  if (opts.cursor !== undefined) {
    const key = decodeCursor(opts.cursor);
    where.push(
      `(em.created_at, em.id) < (${p.add(key.created_at)}::timestamptz, ${p.add(key.id)}::uuid)`,
    );
  }

  const res = await db.query<EquipmentRow>(
    `${EQUIPMENT_SELECT}
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY em.created_at DESC, em.id DESC
     LIMIT ${p.add(opts.limit + 1)}`,
    p.values,
  );
  const page = paginate(res.rows, opts.limit);
  return { items: page.items.map(toEquipmentSummary), next_cursor: page.next_cursor };
}

export async function getEquipmentBySlug(db: CatalogDb, slug: string): Promise<EquipmentDetail> {
  const res = await db.query<EquipmentRow>(`${EQUIPMENT_SELECT} WHERE em.slug = $1`, [slug]);
  const row = res.rows[0];
  if (!row) throw notFound('Equipment model not found.');
  return { ...toEquipmentSummary(row), specs: parseSpecs(row.specs) };
}

export async function getEquipmentById(
  db: CatalogDb,
  id: string,
): Promise<EquipmentDetail | null> {
  const res = await db.query<EquipmentRow>(`${EQUIPMENT_SELECT} WHERE em.id = $1::uuid`, [id]);
  const row = res.rows[0];
  return row ? { ...toEquipmentSummary(row), specs: parseSpecs(row.specs) } : null;
}

export async function listEquipmentBrands(db: CatalogDb): Promise<EquipmentBrandRef[]> {
  const res = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM equipment_brands ORDER BY name ASC`,
  );
  return res.rows;
}

// ---------------------------------------------------------------------------
// Origins
// ---------------------------------------------------------------------------

export async function listOrigins(db: CatalogDb): Promise<OriginSummary[]> {
  const res = await db.query<{
    id: string;
    country: string;
    region: string | null;
    description: string | null;
    coffee_count: number;
  }>(
    `SELECT o.id, o.country, o.region, o.description,
            (SELECT count(*)
             FROM coffee_lots cl
             JOIN coffee_products cp ON cp.coffee_lot_id = cl.id
             WHERE cl.origin_id = o.id)::int AS coffee_count
     FROM origins o
     ORDER BY o.country ASC, o.region ASC NULLS FIRST`,
  );
  return res.rows.map((r) => ({ ...r, coffee_count: Number(r.coffee_count) }));
}

// ---------------------------------------------------------------------------
// Search (CAT-07) — Postgres full text across the three headline entity types
// ---------------------------------------------------------------------------

export type SearchType = 'coffee' | 'roaster' | 'equipment';

export async function search(
  db: CatalogDb,
  opts: { q: string; types: SearchType[]; limit: number },
): Promise<SearchHit[]> {
  const p = new Params();
  // The user's query is bound ONCE and reused by every branch via the alias.
  const qParam = p.add(opts.q);

  const branches: string[] = [];
  if (opts.types.includes('coffee')) {
    branches.push(`
      SELECT 'coffee'::text AS type, cp.id::text AS id, cp.slug AS slug,
             cp.name AS label, r.name AS sublabel,
             ts_rank(${COFFEE_TSVECTOR}, tsq.q) AS score
      ${COFFEE_FROM}
      CROSS JOIN plainto_tsquery('english', ${qParam}) AS tsq(q)
      WHERE ${COFFEE_TSVECTOR} @@ tsq.q`);
  }
  if (opts.types.includes('roaster')) {
    branches.push(`
      SELECT 'roaster'::text AS type, r.id::text AS id, r.slug AS slug,
             r.name AS label, r.location AS sublabel,
             ts_rank(${ROASTER_TSVECTOR}, tsq.q) AS score
      FROM roasters r
      CROSS JOIN plainto_tsquery('english', ${qParam}) AS tsq(q)
      WHERE ${ROASTER_TSVECTOR} @@ tsq.q`);
  }
  if (opts.types.includes('equipment')) {
    branches.push(`
      SELECT 'equipment'::text AS type, em.id::text AS id, em.slug AS slug,
             eb.name || ' ' || em.name AS label, em.category AS sublabel,
             ts_rank(${EQUIPMENT_TSVECTOR}, tsq.q) AS score
      FROM equipment_models em
      JOIN equipment_brands eb ON eb.id = em.brand_id
      CROSS JOIN plainto_tsquery('english', ${qParam}) AS tsq(q)
      WHERE ${EQUIPMENT_TSVECTOR} @@ tsq.q`);
  }
  if (branches.length === 0) return [];

  const res = await db.query<SearchHit & { score: number | string }>(
    `SELECT * FROM (${branches.join('\n      UNION ALL\n')}) hits
     ORDER BY score DESC, label ASC
     LIMIT ${p.add(opts.limit)}`,
    p.values,
  );
  return res.rows.map((r) => ({ ...r, score: Number(r.score) }));
}

// ---------------------------------------------------------------------------
// Autocomplete (CAT-06) — powers the §5 "no free text" entity picker
// ---------------------------------------------------------------------------

/**
 * Ranking is deliberately simple and index-friendly:
 *   0 exact label · 1 label prefix · 2 prefix of a later word · 3 substring.
 * Ties break on the shorter label, then alphabetically — so typing "en"
 * surfaces "Encore" before "Encore ESP" before "Baratza Virtuoso+ Encore-ish".
 */
export async function autocomplete(
  db: CatalogDb,
  opts: { q: string; types: SearchType[]; limit: number },
): Promise<AutocompleteItem[]> {
  const p = new Params();
  const lowered = opts.q.toLowerCase();
  const escaped = escapeLike(lowered);
  const exact = p.add(lowered);
  const prefix = p.add(`${escaped}%`);
  const wordPrefix = p.add(`% ${escaped}%`);
  const contains = p.add(`%${escaped}%`);

  const rank = (label: string): string => `
    CASE WHEN lower(${label}) = ${exact}                          THEN 0
         WHEN lower(${label}) LIKE ${prefix}      ESCAPE '\\'      THEN 1
         WHEN lower(${label}) LIKE ${wordPrefix}  ESCAPE '\\'      THEN 2
         ELSE 3 END`;

  const branches: string[] = [];
  if (opts.types.includes('coffee')) {
    branches.push(`
      SELECT 'coffee'::text AS type, cp.id::text AS id, cp.slug AS slug,
             cp.name AS label, r.name AS sublabel,
             ${rank('cp.name')} AS rank
      FROM coffee_products cp
      JOIN roasters r ON r.id = cp.roaster_id
      WHERE lower(cp.name) LIKE ${contains} ESCAPE '\\'
         OR lower(r.name)  LIKE ${contains} ESCAPE '\\'`);
  }
  if (opts.types.includes('roaster')) {
    branches.push(`
      SELECT 'roaster'::text AS type, r.id::text AS id, r.slug AS slug,
             r.name AS label, r.location AS sublabel,
             ${rank('r.name')} AS rank
      FROM roasters r
      WHERE lower(r.name) LIKE ${contains} ESCAPE '\\'`);
  }
  if (opts.types.includes('equipment')) {
    branches.push(`
      SELECT 'equipment'::text AS type, em.id::text AS id, em.slug AS slug,
             eb.name || ' ' || em.name AS label, em.category AS sublabel,
             ${rank("eb.name || ' ' || em.name")} AS rank
      FROM equipment_models em
      JOIN equipment_brands eb ON eb.id = em.brand_id
      WHERE lower(eb.name || ' ' || em.name) LIKE ${contains} ESCAPE '\\'`);
  }
  if (branches.length === 0) return [];

  const res = await db.query<AutocompleteItem & { rank: number }>(
    `SELECT type, id, slug, label, sublabel
     FROM (${branches.join('\n      UNION ALL\n')}) hits
     ORDER BY rank ASC, length(label) ASC, label ASC
     LIMIT ${p.add(opts.limit)}`,
    p.values,
  );
  return res.rows.map(({ type, id, slug, label, sublabel }) => ({
    type,
    id,
    slug,
    label,
    sublabel,
  }));
}

// ---------------------------------------------------------------------------
// Grind conversions (§6.4)
// ---------------------------------------------------------------------------

interface GrindConversionRow {
  id: string;
  from_setting: string;
  to_setting: string;
  source: GrindConversionSource;
  confidence: number | string;
  pair_sample_size: number | string;
  from_id: string;
  from_slug: string;
  from_name: string;
  from_brand: string;
  from_scale: GrindScaleType | null;
  to_id: string;
  to_slug: string;
  to_name: string;
  to_brand: string;
  to_scale: GrindScaleType | null;
}

const band = (confidence: number): 'low' | 'medium' | 'high' =>
  confidence >= 0.75 ? 'high' : confidence >= 0.5 ? 'medium' : 'low';

/**
 * `sample_size` is the number of conversion data points recorded for the
 * grinder PAIR, computed with a window over the filtered result set. The
 * 0003 schema stores one row per confirmed (from, from_setting, to, to_setting)
 * tuple rather than a counter, so the count of those rows is the honest
 * "N community data points" figure §6.4 asks us to surface.
 */
export async function listGrindConversions(
  db: CatalogDb,
  opts: { fromModelId: string; toModelId?: string },
): Promise<GrindConversion[]> {
  const res = await db.query<GrindConversionRow>(
    `SELECT gc.id, gc.from_setting, gc.to_setting, gc.source, gc.confidence,
            count(*) OVER (PARTITION BY gc.from_model_id, gc.to_model_id)::int
              AS pair_sample_size,
            fm.id AS from_id, fm.slug AS from_slug, fm.name AS from_name,
            fm.grind_scale_type AS from_scale, fb.name AS from_brand,
            tm.id AS to_id, tm.slug AS to_slug, tm.name AS to_name,
            tm.grind_scale_type AS to_scale, tb.name AS to_brand
     FROM grind_conversions gc
     JOIN equipment_models  fm ON fm.id = gc.from_model_id
     JOIN equipment_brands  fb ON fb.id = fm.brand_id
     JOIN equipment_models  tm ON tm.id = gc.to_model_id
     JOIN equipment_brands  tb ON tb.id = tm.brand_id
     WHERE gc.from_model_id = $1::uuid
       AND ($2::uuid IS NULL OR gc.to_model_id = $2::uuid)
     ORDER BY gc.confidence DESC, tm.name ASC, gc.from_setting ASC`,
    [opts.fromModelId, opts.toModelId ?? null],
  );

  return res.rows.map((row) => {
    const confidence = Number(row.confidence);
    return {
      id: row.id,
      from_model: {
        id: row.from_id,
        slug: row.from_slug,
        name: row.from_name,
        brand: row.from_brand,
        grind_scale_type: row.from_scale,
      },
      from_setting: row.from_setting,
      to_model: {
        id: row.to_id,
        slug: row.to_slug,
        name: row.to_name,
        brand: row.to_brand,
        grind_scale_type: row.to_scale,
      },
      to_setting: row.to_setting,
      uncertainty: {
        confidence,
        sample_size: Number(row.pair_sample_size),
        source: row.source,
        band: band(confidence),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Editorial writes (CAT-05) — staff only; authorization happens in the routes
// ---------------------------------------------------------------------------

export interface RoasterInput {
  /** Provenance (0014). Defaults to 'editorial' — staff and seed writes. */
  source?: 'editorial' | 'community' | null;
  submitted_by?: string | null;
  name: string;
  slug: string;
  location?: string | null;
  verified?: boolean;
}

export async function insertRoaster(db: CatalogDb, input: RoasterInput): Promise<RoasterSummary> {
  try {
    const res = await db.query<{ id: string }>(
      `INSERT INTO roasters (name, slug, location, verified, source, submitted_by)
       VALUES ($1, $2, $3, coalesce($4::boolean, false),
               coalesce($5, 'editorial'), $6::uuid)
       RETURNING id`,
      [
        input.name,
        input.slug,
        input.location ?? null,
        input.verified ?? null,
        input.source ?? null,
        input.submitted_by ?? null,
      ],
    );
    const id = res.rows[0]?.id;
    if (!id) throw new Error('insert returned no row');
    return await requireRoasterById(db, id);
  } catch (err) {
    return translateWriteError(err, 'roaster');
  }
}

export async function updateRoaster(
  db: CatalogDb,
  id: string,
  patch: Partial<RoasterInput>,
): Promise<RoasterSummary> {
  const p = new Params();
  const sets: string[] = [];
  if (patch.name !== undefined) sets.push(`name = ${p.add(patch.name)}`);
  if (patch.slug !== undefined) sets.push(`slug = ${p.add(patch.slug)}`);
  if (patch.location !== undefined) sets.push(`location = ${p.add(patch.location)}`);
  if (patch.verified !== undefined) sets.push(`verified = ${p.add(patch.verified)}`);
  if (sets.length === 0) throw badRequest('No updatable fields supplied.');

  try {
    const res = await db.query<{ id: string }>(
      `UPDATE roasters SET ${sets.join(', ')} WHERE id = ${p.add(id)}::uuid RETURNING id`,
      p.values,
    );
    if (!res.rows[0]) throw notFound('Roaster not found.');
    return await requireRoasterById(db, id);
  } catch (err) {
    return translateWriteError(err, 'roaster');
  }
}

async function requireRoasterById(db: CatalogDb, id: string): Promise<RoasterSummary> {
  const res = await db.query<RoasterRow>(`${ROASTER_SELECT} WHERE r.id = $1::uuid`, [id]);
  const row = res.rows[0];
  if (!row) throw notFound('Roaster not found.');
  return toRoasterSummary(row);
}

export interface CoffeeInput {
  /** Provenance (0014). Defaults to 'editorial'. */
  source?: 'editorial' | 'community' | null;
  submitted_by?: string | null;
  roaster_id: string;
  coffee_lot_id?: string | null;
  name: string;
  slug: string;
  roast_level: RoastLevel;
  intended_use: IntendedUse;
  tasting_notes?: string[];
  status?: CoffeeStatus;
}

export async function insertCoffee(db: CatalogDb, input: CoffeeInput): Promise<CoffeeDetail> {
  try {
    const res = await db.query<{ slug: string }>(
      `INSERT INTO coffee_products
         (roaster_id, coffee_lot_id, name, slug, roast_level, intended_use,
          tasting_notes, status, source, submitted_by)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6,
               coalesce($7::text[], '{}'::text[]), coalesce($8::text, 'active'),
               coalesce($9, 'editorial'), $10::uuid)
       RETURNING slug`,
      [
        input.roaster_id,
        input.coffee_lot_id ?? null,
        input.name,
        input.slug,
        input.roast_level,
        input.intended_use,
        input.tasting_notes ?? null,
        input.status ?? null,
        input.source ?? null,
        input.submitted_by ?? null,
      ],
    );
    const slug = res.rows[0]?.slug;
    if (!slug) throw new Error('insert returned no row');
    return await getCoffeeBySlug(db, slug);
  } catch (err) {
    return translateWriteError(err, 'coffee');
  }
}

export async function updateCoffee(
  db: CatalogDb,
  id: string,
  patch: Partial<CoffeeInput>,
): Promise<CoffeeDetail> {
  const p = new Params();
  const sets: string[] = [];
  if (patch.roaster_id !== undefined) sets.push(`roaster_id = ${p.add(patch.roaster_id)}::uuid`);
  if (patch.coffee_lot_id !== undefined) {
    sets.push(`coffee_lot_id = ${p.add(patch.coffee_lot_id)}::uuid`);
  }
  if (patch.name !== undefined) sets.push(`name = ${p.add(patch.name)}`);
  if (patch.slug !== undefined) sets.push(`slug = ${p.add(patch.slug)}`);
  if (patch.roast_level !== undefined) sets.push(`roast_level = ${p.add(patch.roast_level)}`);
  if (patch.intended_use !== undefined) sets.push(`intended_use = ${p.add(patch.intended_use)}`);
  if (patch.tasting_notes !== undefined) {
    sets.push(`tasting_notes = ${p.add(patch.tasting_notes)}::text[]`);
  }
  if (patch.status !== undefined) sets.push(`status = ${p.add(patch.status)}`);
  if (sets.length === 0) throw badRequest('No updatable fields supplied.');

  try {
    const res = await db.query<{ slug: string }>(
      `UPDATE coffee_products SET ${sets.join(', ')}
       WHERE id = ${p.add(id)}::uuid RETURNING slug`,
      p.values,
    );
    const slug = res.rows[0]?.slug;
    if (!slug) throw notFound('Coffee not found.');
    return await getCoffeeBySlug(db, slug);
  } catch (err) {
    return translateWriteError(err, 'coffee');
  }
}

export interface EquipmentInput {
  brand_id: string;
  category: EquipmentCategory;
  name: string;
  slug: string;
  specs?: Record<string, unknown>;
  grind_scale_type?: GrindScaleType | null;
  /** Provenance (0013). Defaults to 'editorial' — staff and seed writes. */
  source?: 'editorial' | 'community' | null;
  /** Who submitted it, when it came from a member rather than an editor. */
  submitted_by?: string | null;
}

/**
 * Find or create a brand by name.
 *
 * Needed because the staff create route takes a brand_id, and a piece of
 * equipment nobody has catalogued often belongs to a brand nobody has
 * catalogued either. Case-insensitive on the way in: "Option-O" and "option-o"
 * are one brand, and letting both exist would split every future model between
 * them.
 */
export async function upsertEquipmentBrand(db: CatalogDb, name: string): Promise<string> {
  const trimmed = name.trim();
  const existing = await db.query<{ id: string }>(
    `SELECT id::text AS id FROM equipment_brands WHERE lower(name) = lower($1)`,
    [trimmed],
  );
  const found = existing.rows[0]?.id;
  if (found) return found;

  const created = await db.query<{ id: string }>(
    `INSERT INTO equipment_brands (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id::text AS id`,
    [trimmed],
  );
  return created.rows[0]!.id;
}

/**
 * Words that do not distinguish one product from another.
 *
 * Assembled from what the assistant actually produced against production, not
 * from imagination: it answered "V60 02 Ceramic Dripper" for a dripper the
 * catalogue already held as "V60 Dripper 02", and "Burr Coffee Grinder KCG8433
 * (Matte Black)" for a KitchenAid. Category nouns, materials and colours are
 * how a model pads a name; none of them identify a different object.
 *
 * Deliberately NOT in here: anything that could be a model designation, a
 * capacity or a size. Those are exactly what tells two products apart.
 */
const NAME_NOISE = new Set([
  // category nouns
  'coffee', 'brewer', 'brewing', 'dripper', 'drip', 'grinder', 'grinders', 'kettle',
  'scale', 'scales', 'machine', 'maker', 'press', 'filter', 'cone', 'pot', 'set', 'kit',
  // manner-of-operation words
  'electric', 'manual', 'hand', 'handheld', 'burr', 'burrs', 'pour', 'over', 'pourover',
  'automatic', 'auto', 'digital',
  // materials — a V60 in ceramic and a V60 in glass are one catalogue entry
  'ceramic', 'glass', 'plastic', 'metal', 'steel', 'stainless', 'copper', 'resin',
  // colours and finishes
  'matte', 'gloss', 'black', 'white', 'red', 'blue', 'green', 'grey', 'gray', 'silver',
  'clear', 'olive', 'navy', 'pink', 'cream', 'charcoal',
  // filler
  'edition', 'model', 'series', 'the', 'with', 'and', 'for', 'in', 'by',
]);

/**
 * A name reduced to the tokens that actually identify the product.
 *
 * Sorted and de-duplicated, so word order stops mattering: "V60 02 Ceramic
 * Dripper" and "V60 Dripper 02" both become "02 v60". A model code survives
 * because it is never noise — which is the safety property that keeps "Lagom
 * P64" and "Lagom P100" apart.
 */
export function normalizeEquipmentName(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '' && !NAME_NOISE.has(token));
  // A name made ENTIRELY of noise ("Coffee Grinder") normalises to nothing, and
  // an empty key would match every other empty key. Fall back to the raw name:
  // a bad match is worse than a missed one, because it merges two products.
  if (tokens.length === 0) return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return [...new Set(tokens)].sort().join(' ');
}

/**
 * Is this equipment already catalogued?
 *
 * Matters far more since the assistant publishes without a human (0013): the
 * fiftieth person to photograph a Hario V60 must not create the fiftieth "Hario
 * V60" row. A human reviewer would have spotted that instantly; nothing else
 * will.
 *
 * ── WHY NOT EXACT MATCHING ──────────────────────────────────────────────────
 * It was, and it failed on the first real submission. The catalogue held "V60
 * Dripper 02"; the assistant answered "V60 02 Ceramic Dripper"; neither the
 * slug nor the name matched, and a duplicate went public. Naming variance is
 * not an edge case here — it is what a language model does every time.
 *
 * ── WHY NOT SIMILARITY MATCHING ─────────────────────────────────────────────
 * "Lagom P64" and "Lagom P100" score high on any trigram or edit-distance
 * measure and are different grinders. Merging them attributes one product's
 * specs to another, which is worse than a duplicate row, because it is wrong
 * rather than merely untidy.
 *
 * So: token-set equality after dropping words that never identify a product.
 * Model codes contain digits, are never noise, and must therefore be present on
 * both sides for a match — which is exactly the distinction similarity blurs.
 */
export async function findExistingEquipment(
  db: CatalogDb,
  input: { brand: string; name: string; slug: string },
): Promise<{ id: string; slug: string; name: string } | null> {
  const bySlug = await db.query<{ id: string; slug: string; name: string }>(
    `SELECT id::text AS id, slug, name FROM equipment_models WHERE slug = $1 LIMIT 1`,
    [input.slug],
  );
  if (bySlug.rows[0]) return bySlug.rows[0];

  // Everything this brand already has. Small by construction — the largest
  // brand in a coffee-equipment catalogue has tens of models, not thousands —
  // so comparing in code beats trying to express the rule in SQL.
  const { rows } = await db.query<{ id: string; slug: string; name: string }>(
    `SELECT m.id::text AS id, m.slug, m.name
       FROM equipment_models m
       JOIN equipment_brands b ON b.id = m.brand_id
      WHERE lower(b.name) = lower($1)`,
    [input.brand.trim()],
  );

  const wanted = normalizeEquipmentName(input.name);
  return rows.find((row) => normalizeEquipmentName(row.name) === wanted) ?? null;
}

export async function insertEquipmentModel(
  db: CatalogDb,
  input: EquipmentInput,
): Promise<EquipmentDetail> {
  try {
    const res = await db.query<{ slug: string }>(
      `INSERT INTO equipment_models
              (brand_id, category, name, slug, specs, grind_scale_type, source, submitted_by)
       VALUES ($1::uuid, $2, $3, $4, coalesce($5::jsonb, '{}'::jsonb), $6,
               coalesce($7, 'editorial'), $8::uuid)
       RETURNING slug`,
      [
        input.brand_id,
        input.category,
        input.name,
        input.slug,
        input.specs ? JSON.stringify(input.specs) : null,
        input.grind_scale_type ?? null,
        // Provenance travels with the row (0013). A community row that nobody
        // has confirmed is a queryable fact rather than an archaeology project.
        input.source ?? null,
        input.submitted_by ?? null,
      ],
    );
    const slug = res.rows[0]?.slug;
    if (!slug) throw new Error('insert returned no row');
    return await getEquipmentBySlug(db, slug);
  } catch (err) {
    return translateWriteError(err, 'equipment model');
  }
}

export async function updateEquipmentModel(
  db: CatalogDb,
  id: string,
  patch: Partial<EquipmentInput>,
): Promise<EquipmentDetail> {
  const p = new Params();
  const sets: string[] = [];
  if (patch.brand_id !== undefined) sets.push(`brand_id = ${p.add(patch.brand_id)}::uuid`);
  if (patch.category !== undefined) sets.push(`category = ${p.add(patch.category)}`);
  if (patch.name !== undefined) sets.push(`name = ${p.add(patch.name)}`);
  if (patch.slug !== undefined) sets.push(`slug = ${p.add(patch.slug)}`);
  if (patch.specs !== undefined) sets.push(`specs = ${p.add(JSON.stringify(patch.specs))}::jsonb`);
  if (patch.grind_scale_type !== undefined) {
    sets.push(`grind_scale_type = ${p.add(patch.grind_scale_type)}::text`);
  }
  if (sets.length === 0) throw badRequest('No updatable fields supplied.');

  try {
    const res = await db.query<{ slug: string }>(
      `UPDATE equipment_models SET ${sets.join(', ')}
       WHERE id = ${p.add(id)}::uuid RETURNING slug`,
      p.values,
    );
    const slug = res.rows[0]?.slug;
    if (!slug) throw notFound('Equipment model not found.');
    return await getEquipmentBySlug(db, slug);
  } catch (err) {
    return translateWriteError(err, 'equipment model');
  }
}

/* ------------------------------------------------------------------ *
 * Community submissions (0014)
 * ------------------------------------------------------------------ */

/**
 * Find or create a roaster by name, UNVERIFIED.
 *
 * Every coffee needs one (`roaster_id NOT NULL`), so a member submitting a bag
 * necessarily mints a roaster row. Two rules make that survivable:
 *
 *   * case-insensitive match first, so "Onyx" and "onyx" are one business
 *     rather than two competing pages
 *   * `verified` is never set here and must never be. It is the difference
 *     between "somebody typed this name" and "we know this business", and a
 *     model reading a label cannot establish the second.
 */
export async function upsertRoasterByName(
  db: CatalogDb,
  name: string,
  submittedBy: string | null,
): Promise<{ id: string; created: boolean }> {
  const trimmed = name.trim();
  const existing = await db.query<{ id: string }>(
    `SELECT id::text AS id FROM roasters WHERE lower(name) = lower($1) LIMIT 1`,
    [trimmed],
  );
  const found = existing.rows[0]?.id;
  if (found) return { id: found, created: false };

  // Slug collisions are real here: two differently-named roasters can slugify
  // the same way. A numeric suffix keeps both, which is better than refusing a
  // submission over a URL.
  const base = slugify(trimmed);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      const created = await db.query<{ id: string }>(
        `INSERT INTO roasters (name, slug, verified, source, submitted_by)
         VALUES ($1, $2, false, 'community', $3::uuid)
         RETURNING id::text AS id`,
        [trimmed, slug, submittedBy],
      );
      return { id: created.rows[0]!.id, created: true };
    } catch (err) {
      const { code } = pgError(err);
      if (code !== '23505') throw err;
    }
  }
  throw conflict('Could not find a free slug for that roaster.');
}

/**
 * Is this coffee already catalogued?
 *
 * Same reasoning as `findExistingEquipment`, and the same normaliser — a
 * roaster's own name for a coffee varies between the bag, the website and
 * whatever the person typed. Scoped to the roaster, because "Ethiopia
 * Guji" from two roasters is two different coffees.
 */
export async function findExistingCoffee(
  db: CatalogDb,
  input: { roasterId: string; name: string },
): Promise<{ id: string; slug: string; name: string } | null> {
  const { rows } = await db.query<{ id: string; slug: string; name: string }>(
    `SELECT id::text AS id, slug, name FROM coffee_products WHERE roaster_id = $1::uuid`,
    [input.roasterId],
  );
  const wanted = normalizeEquipmentName(input.name);
  return rows.find((row) => normalizeEquipmentName(row.name) === wanted) ?? null;
}

/** A slug nobody is using yet. Coffee names collide far more than gear does. */
export async function freeCoffeeSlug(db: CatalogDb, base: string): Promise<string> {
  const root = slugify(base);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const { rows } = await db.query<{ id: string }>(
      `SELECT id::text AS id FROM coffee_products WHERE slug = $1`,
      [slug],
    );
    if (rows.length === 0) return slug;
  }
  throw conflict('Could not find a free slug for that coffee.');
}

/** Records the roast date of a bag, if the label had one. */
export async function recordRoastBatch(
  db: CatalogDb,
  coffeeProductId: string,
  roastDate: string,
): Promise<void> {
  await db.query(
    `INSERT INTO roast_batches (coffee_product_id, roast_date)
          VALUES ($1::uuid, $2::date)
     ON CONFLICT DO NOTHING`,
    [coffeeProductId, roastDate],
  );
}
