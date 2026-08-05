/**
 * Catalog + recipe read models for the public SEO pages (CAT-09, REC-06).
 *
 * ── Why this file lives under components/catalog/ ─────────────────────────────
 * It is data plumbing and would be happier at `lib/catalog.ts`, but this lane
 * owns `components/catalog/**` and not new files under `lib/` beyond seo.ts and
 * structured-data.ts. Flagged in the lane report as a one-line move for the
 * orchestrator; nothing else needs to change when it happens.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Two rules shape everything below:
 *
 *  1. **The API is snake_case.** `apps/api/src/modules/catalog/types.ts` is the
 *     contract (verified by curl against the live dev API); these types mirror
 *     it verbatim rather than inventing a camelCase dialect that would silently
 *     read `undefined`. (Note: `lib/api.ts#CoffeeSummary` is camelCase and does
 *     NOT match the live API — see the lane report.)
 *  2. **A missing sub-resource must never 500 a page.** Recipes are being built
 *     in parallel (Lane H) and 404 today. Every loader here returns a tagged
 *     result instead of throwing, so a coffee page renders fully with a warm
 *     "no recipes yet" state.
 *
 * Reads go through `apiFetch` (not `serverApiFetch`): catalog data is public, so
 * forwarding cookies would make every response uncacheable for nothing.
 */
import { ApiError, apiFetch, type ApiRequestOptions } from '../../lib/api';

/* ------------------------------------------------------------------ *
 * Controlled vocabularies (mirror of the API's catalog schemas)
 * ------------------------------------------------------------------ */

export const ROAST_LEVELS = ['light', 'medium-light', 'medium', 'medium-dark', 'dark'] as const;
export const INTENDED_USES = ['filter', 'espresso', 'omni'] as const;
export const COFFEE_STATUSES = ['active', 'seasonal', 'discontinued'] as const;
export const LOT_PROCESSES = ['washed', 'natural', 'honey', 'anaerobic', 'experimental'] as const;
export const EQUIPMENT_CATEGORIES = [
  'brewer',
  'grinder',
  'kettle',
  'scale',
  'machine',
  'accessory',
] as const;

export type RoastLevel = (typeof ROAST_LEVELS)[number];
export type IntendedUse = (typeof INTENDED_USES)[number];
export type CoffeeStatus = (typeof COFFEE_STATUSES)[number];
export type LotProcess = (typeof LOT_PROCESSES)[number];
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];
export type GrindScaleType = 'stepped' | 'stepless' | 'rotational';

export type GrindCategory =
  | 'extra_fine'
  | 'fine'
  | 'medium_fine'
  | 'medium'
  | 'medium_coarse'
  | 'coarse';

/* ------------------------------------------------------------------ *
 * Entity shapes
 * ------------------------------------------------------------------ */

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

/** `{id, slug, name}` — the shape every catalog reference carries so a page can
 *  link into the entity graph without a second round-trip (§5). */
export interface EntityRef {
  id: string;
  slug: string;
  name: string;
}

export type RoasterRef = EntityRef;

export interface OriginRef {
  id: string;
  country: string;
  region: string | null;
}

export interface FarmRef {
  id: string;
  name: string;
  story: string | null;
}

export interface CoffeeLot {
  id: string;
  process: LotProcess | null;
  process_detail: string | null;
  varietals: string[];
  altitude_masl: number | null;
  harvest_period: string | null;
  origin: OriginRef | null;
  farm: FarmRef | null;
}

export interface CoffeeSummary {
  id: string;
  slug: string;
  name: string;
  roast_level: RoastLevel;
  intended_use: IntendedUse;
  tasting_notes: string[];
  status: CoffeeStatus;
  roaster: RoasterRef;
  origin: OriginRef | null;
  process: LotProcess | null;
  created_at: string;
  updated_at: string;
}

export interface RoastBatch {
  id: string;
  roast_date: string;
}

export interface CoffeeDetail extends CoffeeSummary {
  lot: CoffeeLot | null;
  roast_batches: RoastBatch[];
}

export interface RoasterSummary {
  id: string;
  slug: string;
  name: string;
  location: string | null;
  verified: boolean;
  coffee_count: number;
  created_at: string;
  updated_at: string;
  /** Optional in the live API today; rendered when the editorial fields land. */
  website_url?: string | null;
  description?: string | null;
}

export interface RoasterDetail extends RoasterSummary {
  coffees: CoffeeSummary[];
}

export interface EquipmentBrandRef {
  id: string;
  name: string;
}

export interface EquipmentSummary {
  id: string;
  slug: string;
  name: string;
  category: EquipmentCategory;
  grind_scale_type: GrindScaleType | null;
  brand: EquipmentBrandRef;
  created_at: string;
  updated_at: string;
}

export interface EquipmentDetail extends EquipmentSummary {
  specs: Record<string, unknown>;
}

export interface OriginSummary extends OriginRef {
  description: string | null;
  coffee_count: number;
}

/* --- grind conversion (§6.4) --------------------------------------- */

export interface GrindUncertainty {
  confidence: number;
  sample_size: number;
  source: 'user_confirmed' | 'seeded';
  band: 'low' | 'medium' | 'high';
}

export interface GrindModelRef {
  id: string;
  slug: string;
  name: string;
  brand: string;
  grind_scale_type: GrindScaleType | null;
}

export interface GrindConversion {
  id: string;
  from_model: GrindModelRef;
  from_setting: string;
  to_model: GrindModelRef;
  to_setting: string;
  uncertainty: GrindUncertainty;
}

export interface GrindConversionResponse {
  items: GrindConversion[];
  disclaimer: string;
}

/**
 * Last-resort disclaimer. The API always sends one (§6.4 makes it mandatory);
 * this exists only so the UI can never render a converted number *without* the
 * honesty line, even if the payload arrives malformed.
 */
export const FALLBACK_GRIND_DISCLAIMER =
  'Converted grind settings are approximate starting points derived from community data. ' +
  'Dial in by taste — burr alignment, wear and unit-to-unit variance all move the target.';

/* --- recipes (Lane H; tolerant shapes) ------------------------------ */

export interface PourStep {
  at_s: number;
  to_g: number;
  note?: string;
}

export interface GrindSetting {
  equipment_model_id: string | null;
  setting: string | null;
  scale_type: GrindScaleType | null;
  category: GrindCategory;
}

export interface FilterParams {
  method: 'filter' | 'immersion';
  dose_g: number;
  water_g: number;
  ratio?: number;
  temperature_c?: number;
  pours?: PourStep[];
  brew_time_s?: number;
  filter_type?: string;
  agitation?: string;
}

export interface EspressoParams {
  method: 'espresso';
  dose_in_g: number;
  yield_out_g: number;
  ratio?: number;
  shot_time_s?: number;
  temperature_c?: number;
  pre_infusion_s?: number;
  basket_size_g?: number;
  puck_prep?: string[];
}

export type BrewParams = FilterParams | EspressoParams;

export interface AuthorRef {
  id?: string;
  handle?: string | null;
  display_name?: string | null;
}

export interface RecipeRef {
  id: string;
  title: string;
  author?: AuthorRef | null;
}

/**
 * The recipe read model these pages render. It is a *superset* of
 * `@brewcult/shared-types#Recipe` with the entity refs a public page needs
 * expanded (coffee, brewer, grinder, author, parent). Everything beyond
 * `id`/`title`/`method` is optional so a leaner payload still renders.
 */
export interface RecipeView {
  id: string;
  title: string;
  method: 'filter' | 'immersion' | 'espresso';
  params: BrewParams | null;
  grind: GrindSetting | null;
  author: AuthorRef | null;
  coffee: (EntityRef & { roaster?: RoasterRef | null }) | null;
  brewer: EntityRef | null;
  grinder: EntityRef | null;
  parent: RecipeRef | null;
  changed_fields: string[];
  is_official: boolean;
  created_at: string | null;
  updated_at: string | null;
}

/* ------------------------------------------------------------------ *
 * Loading — tagged results, never throws
 * ------------------------------------------------------------------ */

/** How long a catalog response may be reused. Catalog data changes daily at
 *  most, and these are the pages we want served from cache. */
export const CATALOG_REVALIDATE_SECONDS = 300;

export type LoadResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'missing' }
  | { status: 'error' };

const publicRead = (options?: ApiRequestOptions): ApiRequestOptions => ({
  refreshOn401: false,
  next: { revalidate: CATALOG_REVALIDATE_SECONDS },
  ...options,
});

/**
 * Fetch a public catalog resource. A 404 (or a route that does not exist yet)
 * becomes `missing`; anything else becomes `error`. Callers decide which of the
 * two is fatal for their page — for a *sub*-resource, neither is.
 */
export async function loadPublic<T>(
  path: string,
  options?: ApiRequestOptions,
): Promise<LoadResult<T>> {
  try {
    const data = await apiFetch<T>(path, publicRead(options));
    if (data === undefined || data === null) return { status: 'missing' };
    return { status: 'ok', data };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { status: 'missing' };
    return { status: 'error' };
  }
}

/** Build a `/api/v1/...` query string from a filter record, dropping blanks. */
export function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query === '' ? '' : `?${query}`;
}

/** Tolerates both `{items, next_cursor}` and a bare array (older stubs). */
export function toPage<T>(raw: unknown): Page<T> {
  if (Array.isArray(raw)) return { items: raw as T[], next_cursor: null };
  if (raw && typeof raw === 'object') {
    const record = raw as { items?: unknown; next_cursor?: unknown; nextCursor?: unknown };
    const items = Array.isArray(record.items) ? (record.items as T[]) : [];
    const cursor =
      typeof record.next_cursor === 'string'
        ? record.next_cursor
        : typeof record.nextCursor === 'string'
          ? record.nextCursor
          : null;
    return { items, next_cursor: cursor };
  }
  return { items: [], next_cursor: null };
}

export interface CoffeeFilters {
  roaster?: string | undefined;
  origin?: string | undefined;
  process?: string | undefined;
  roast_level?: string | undefined;
  intended_use?: string | undefined;
  status?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export async function loadCoffees(filters: CoffeeFilters = {}): Promise<LoadResult<Page<CoffeeSummary>>> {
  const result = await loadPublic<unknown>(`/api/v1/coffees${buildQuery({ ...filters })}`);
  if (result.status !== 'ok') return result;
  return { status: 'ok', data: toPage<CoffeeSummary>(result.data) };
}

export function loadCoffee(slug: string): Promise<LoadResult<CoffeeDetail>> {
  return loadPublic<CoffeeDetail>(`/api/v1/coffees/${encodeURIComponent(slug)}`);
}

export async function loadRoasters(
  filters: { verified?: string | undefined; cursor?: string | undefined; limit?: number | undefined } = {},
): Promise<LoadResult<Page<RoasterSummary>>> {
  const result = await loadPublic<unknown>(`/api/v1/roasters${buildQuery({ ...filters })}`);
  if (result.status !== 'ok') return result;
  return { status: 'ok', data: toPage<RoasterSummary>(result.data) };
}

export function loadRoaster(slug: string): Promise<LoadResult<RoasterDetail>> {
  return loadPublic<RoasterDetail>(`/api/v1/roasters/${encodeURIComponent(slug)}`);
}

export async function loadEquipmentList(
  filters: {
    category?: string | undefined;
    brand?: string | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  } = {},
): Promise<LoadResult<Page<EquipmentSummary>>> {
  const result = await loadPublic<unknown>(`/api/v1/equipment${buildQuery({ ...filters })}`);
  if (result.status !== 'ok') return result;
  return { status: 'ok', data: toPage<EquipmentSummary>(result.data) };
}

export function loadEquipment(slug: string): Promise<LoadResult<EquipmentDetail>> {
  return loadPublic<EquipmentDetail>(`/api/v1/equipment/${encodeURIComponent(slug)}`);
}

export async function loadEquipmentBrands(): Promise<EquipmentBrandRef[]> {
  const result = await loadPublic<{ items?: EquipmentBrandRef[] }>('/api/v1/equipment-brands');
  return result.status === 'ok' ? (result.data.items ?? []) : [];
}

export async function loadOrigins(): Promise<OriginSummary[]> {
  const result = await loadPublic<{ items?: OriginSummary[] }>('/api/v1/origins');
  return result.status === 'ok' ? (result.data.items ?? []) : [];
}

/**
 * Grind conversions *out of* one grinder (§6.4). Returns the disclaimer even on
 * failure so the caller can render the honesty line unconditionally.
 */
export async function loadGrindConversions(
  fromModelId: string,
  toModelId?: string,
): Promise<{ status: 'ok' | 'missing' | 'error'; items: GrindConversion[]; disclaimer: string }> {
  const result = await loadPublic<GrindConversionResponse>(
    `/api/v1/grind-conversions${buildQuery({ from_model_id: fromModelId, to_model_id: toModelId })}`,
  );
  if (result.status !== 'ok') {
    return { status: result.status, items: [], disclaimer: FALLBACK_GRIND_DISCLAIMER };
  }
  const items = Array.isArray(result.data.items) ? result.data.items : [];
  const disclaimer =
    typeof result.data.disclaimer === 'string' && result.data.disclaimer.trim() !== ''
      ? result.data.disclaimer
      : FALLBACK_GRIND_DISCLAIMER;
  return { status: 'ok', items, disclaimer };
}

/* --- recipes -------------------------------------------------------- */

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asRef(value: unknown): EntityRef | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = asString(record['id']);
  const name = asString(record['name']) ?? asString(record['title']);
  if (id === null || name === null) return null;
  return { id, slug: asString(record['slug']) ?? '', name };
}

function asAuthor(value: unknown): AuthorRef | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const handle = asString(record['handle']);
  const displayName = asString(record['display_name']) ?? asString(record['displayName']);
  const id = asString(record['id']);
  if (handle === null && displayName === null && id === null) return null;
  return { ...(id !== null ? { id } : {}), handle, display_name: displayName };
}

/**
 * Normalise whatever the recipes API returns into {@link RecipeView}.
 *
 * Deliberately forgiving: Lane H's shape is still landing, and a public page
 * that renders four of five fields beats a page that throws. Anything
 * unrecognised is simply dropped — never guessed at.
 */
export function normalizeRecipe(raw: unknown): RecipeView | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = asString(record['id']);
  if (id === null) return null;

  const params = record['params'];
  const rawMethod =
    asString(record['method']) ??
    (params && typeof params === 'object'
      ? asString((params as Record<string, unknown>)['method'])
      : null);
  const method =
    rawMethod === 'espresso' || rawMethod === 'immersion' || rawMethod === 'filter'
      ? rawMethod
      : 'filter';

  const grindRaw = record['grind'];
  const grind =
    grindRaw && typeof grindRaw === 'object' ? (grindRaw as unknown as GrindSetting) : null;

  const coffeeRef = asRef(record['coffee'] ?? record['coffee_product']);
  const coffeeRoaster = (() => {
    const coffee = record['coffee'] ?? record['coffee_product'];
    if (!coffee || typeof coffee !== 'object') return null;
    return asRef((coffee as Record<string, unknown>)['roaster']);
  })();

  const parentRaw = record['parent'] ?? record['parent_recipe'];
  const parentRef = asRef(parentRaw);
  const parent: RecipeRef | null = parentRef
    ? {
        id: parentRef.id,
        title: parentRef.name,
        author:
          parentRaw && typeof parentRaw === 'object'
            ? asAuthor((parentRaw as Record<string, unknown>)['author'])
            : null,
      }
    : asString(record['parent_recipe_id']) !== null
      ? { id: asString(record['parent_recipe_id']) as string, title: 'the original recipe' }
      : null;

  const changed = record['changed_fields'];

  return {
    id,
    title: asString(record['title']) ?? 'Untitled recipe',
    method,
    params: params && typeof params === 'object' ? (params as unknown as BrewParams) : null,
    grind,
    author: asAuthor(record['author']),
    coffee: coffeeRef
      ? { ...coffeeRef, roaster: coffeeRoaster }
      : null,
    brewer: asRef(record['brewer'] ?? record['brewer_model']),
    grinder: asRef(record['grinder'] ?? record['grinder_model']),
    parent,
    changed_fields: Array.isArray(changed) ? changed.filter((f): f is string => typeof f === 'string') : [],
    is_official: record['is_official'] === true,
    created_at: asString(record['created_at']),
    updated_at: asString(record['updated_at']),
  };
}

export interface RecipeFilters {
  coffee_product_id?: string | undefined;
  brewer_model_id?: string | undefined;
  method?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export async function loadRecipes(
  filters: RecipeFilters = {},
): Promise<LoadResult<Page<RecipeView>>> {
  const result = await loadPublic<unknown>(`/api/v1/recipes${buildQuery({ ...filters })}`);
  if (result.status !== 'ok') return result;
  const page = toPage<unknown>(result.data);
  return {
    status: 'ok',
    data: {
      items: page.items
        .map(normalizeRecipe)
        .filter((recipe): recipe is RecipeView => recipe !== null),
      next_cursor: page.next_cursor,
    },
  };
}

export async function loadRecipe(id: string): Promise<LoadResult<RecipeView>> {
  const result = await loadPublic<unknown>(`/api/v1/recipes/${encodeURIComponent(id)}`);
  if (result.status !== 'ok') return result;
  const recipe = normalizeRecipe(result.data);
  return recipe === null ? { status: 'missing' } : { status: 'ok', data: recipe };
}
