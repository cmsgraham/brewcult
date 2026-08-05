/**
 * `changed_fields` — the stored diff (§6.6, logger UX §2/§3 Path B).
 *
 * This is not decoration. It is the signal that makes three things possible:
 *   * the grinder-conversion dataset (§6.4 point 3) knows what a fork changed,
 *   * "what people change" insight and the AI's one-variable-at-a-time
 *     discipline (§7.2) come for free instead of asking the user,
 *   * the logger can say "you went finer and it got better".
 *
 * CONVENTION: leaf paths, dotted, sorted. `grind.setting`, `params.dose_g`,
 * `brewer_model_id`. Leaves rather than coarse tokens ("grind") because
 * "changed the grinder" and "changed the setting on the same grinder" are
 * different experiments, and collapsing them loses the distinction the
 * conversion dataset depends on. Every path is a prefix match away from the
 * coarse token, so a UI that only wants "grind" can still filter on it.
 *
 * `params.ratio` is deliberately never emitted: it is derived from dose/water,
 * so it moves whenever they do and would double every entry.
 */

/** Fields compared on a recipe, in the order they are reported. */
const RECIPE_SCALARS = [
  'title',
  'coffee_product_id',
  'coffee_style',
  'method',
  'brewer_model_id',
] as const;

/** Fields compared between two brew sessions. */
const SESSION_SCALARS = [
  'recipe_id',
  'coffee_product_id',
  'roast_batch_id',
  'brewer_model_id',
  'grinder_model_id',
  'rating',
] as const;

/** Nested objects compared leaf-by-leaf, and the leaves excluded from each. */
const NESTED_EXCLUSIONS: Record<string, readonly string[]> = { params: ['ratio'] };

export interface DiffableRecipe {
  title: string;
  coffee_product_id: string | null;
  coffee_style: string | null;
  method: string;
  brewer_model_id: string | null;
  grind: Record<string, unknown>;
  params: Record<string, unknown>;
}

export interface DiffableSession {
  recipe_id: string | null;
  coffee_product_id: string | null;
  roast_batch_id: string | null;
  brewer_model_id: string | null;
  grinder_model_id: string | null;
  rating: number | null;
  grind: Record<string, unknown>;
  params: Record<string, unknown>;
  water: Record<string, unknown> | null;
}

/** Diff of a fork (or a conflict copy) against the row it came from (§6.6). */
export function diffRecipes(parent: DiffableRecipe, child: DiffableRecipe): string[] {
  const changed: string[] = [];
  for (const key of RECIPE_SCALARS) {
    if (!sameValue(parent[key], child[key])) changed.push(key);
  }
  changed.push(...diffNested('grind', parent.grind, child.grind));
  changed.push(...diffNested('params', parent.params, child.params));
  return sorted(changed);
}

/**
 * Diff of a session against the user's previous session for the same coffee.
 * Computed server-side whenever the client does not supply one, so the
 * one-variable discipline is captured even from a client that never bothered.
 */
export function diffSessions(previous: DiffableSession, current: DiffableSession): string[] {
  const changed: string[] = [];
  for (const key of SESSION_SCALARS) {
    if (!sameValue(previous[key], current[key])) changed.push(key);
  }
  changed.push(...diffNested('grind', previous.grind, current.grind));
  changed.push(...diffNested('params', previous.params, current.params));
  changed.push(...diffNested('water', previous.water ?? {}, current.water ?? {}));
  return sorted(changed);
}

function diffNested(
  prefix: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  const excluded = NESTED_EXCLUSIONS[prefix] ?? [];
  const a = before ?? {};
  const b = after ?? {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (excluded.includes(key)) continue;
    if (!sameValue(a[key], b[key])) changed.push(`${prefix}.${key}`);
  }
  return changed;
}

/**
 * Value equality for diffing. `null` and `undefined` are the same absence — a
 * client that omits `temperature_c` and one that sends `null` did not change it.
 * Objects and arrays compare by canonical JSON (pour schedules, flavour tags).
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

const sorted = (values: string[]): string[] => [...new Set(values)].sort();
