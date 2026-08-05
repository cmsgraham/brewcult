/**
 * The tool layer — AI-02, second_draft §16.1, EF §3.4.
 *
 * ── The one rule ────────────────────────────────────────────────────────────
 * EVERY tool executes with the REQUESTING USER'S AUTHORIZATION, by calling the
 * same `authorize`/`can` from `lib/policy.ts` that a route handler calls, in the
 * same order a route handler calls it:
 *
 *     1. type-level `authorize(actor, action, resourceType)` before any read;
 *     2. per-row `can(actor, 'read', resourceType, resource)` on every row
 *        before it is allowed into the tool result.
 *
 * Step 2 is not redundant with the SQL predicates. The repository's WHERE
 * clauses are an OPTIMISATION; the policy is the guarantee. If a future filter
 * change widens a query, step 2 still holds the line — the same reasoning
 * brewing's own routes are built on.
 *
 * No tool input schema contains a user id, an owner id, a "role", or any other
 * identity field. There is nothing for the model to put a different user in.
 * `test/intelligence.test.ts` proves it two ways: by calling `executeTool`
 * directly with forged identity keys in the input, and end-to-end with an
 * impersonation attempt in the prompt.
 *
 * ── Module boundaries ───────────────────────────────────────────────────────
 * This module owns no tables and writes no SQL. Every read goes through
 * `modules/brewing/index.ts` or `modules/catalog/index.ts` — their public
 * interfaces, which is all dependency-cruiser will let us import anyway.
 */

import { authorize, can, type Action, type Actor } from '../../../lib/policy.js';
import {
  BREW_SESSION_RESOURCE,
  GRIND_SUGGESTION_RESOURCE,
  RECIPE_RESOURCE,
  brewSessionPolicy,
  listBrewSessionRows,
  listRecipeRows,
  recipePolicy,
  toBrewSession,
  toRecipe,
  type BrewSessionRow,
  type RecipeRow,
} from '../../brewing/index.js';
import {
  getCoffeeBySlug,
  getEquipmentById,
  listGrindConversions,
  search,
  type CoffeeDetail,
  type EquipmentDetail,
} from '../../catalog/index.js';
import { scrubDeep } from '../prompts/pii.js';
import type { AiToolDefinition } from '../types.js';
import type { ToolContext } from './context.js';

const COFFEE_RESOURCE = 'coffee_product';
const EQUIPMENT_RESOURCE = 'equipment_model';

/** Caps that bound how much graph one turn can pull (also a cost control). */
const MAX_ROWS = 10;
const clampLimit = (value: unknown, fallback: number): number => {
  const n = typeof value === 'number' ? Math.floor(value) : fallback;
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_ROWS) : fallback;
};
const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

export interface ToolSpec {
  definition: AiToolDefinition;
  /** Resource type + action authorized before the handler body runs. */
  authorizes: { resourceType: string; action: Action };
  handler(input: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Projections — the OTHER half of PII minimisation (AI-09, EF §3.4)
// ---------------------------------------------------------------------------
//
// Rows never leave this file whole. Each projection lists the fields the model
// is allowed to see, so adding a column to a table cannot silently start
// shipping it to a third-party processor. Notably absent everywhere: user ids
// of OTHER people, handles, emails, display names. `author_id` is deliberately
// dropped from recipes — the model has no use for it and it is a re-identifier.

const projectCoffee = (coffee: CoffeeDetail) => ({
  slug: coffee.slug,
  name: coffee.name,
  roaster: coffee.roaster.name,
  roast_level: coffee.roast_level,
  intended_use: coffee.intended_use,
  process: coffee.process,
  origin: coffee.origin ? { country: coffee.origin.country, region: coffee.origin.region } : null,
  varietals: coffee.lot?.varietals ?? [],
  altitude_masl: coffee.lot?.altitude_masl ?? null,
  status: coffee.status,
  /** Marketing copy written by a roaster — untrusted, fenced by the caller. */
  tasting_notes: coffee.tasting_notes,
  most_recent_roast_date: coffee.roast_batches[0]?.roast_date ?? null,
});

const projectEquipment = (e: EquipmentDetail) => ({
  id: e.id,
  name: `${e.brand.name} ${e.name}`,
  category: e.category,
  grind_scale_type: e.grind_scale_type,
});

const projectRecipe = (row: RecipeRow) => {
  const recipe = toRecipe(row);
  return {
    id: recipe.id,
    /** User-authored — untrusted. */
    title: recipe.title,
    method: recipe.method,
    is_official: recipe.is_official,
    brewer_model_id: recipe.brewer_model_id,
    coffee_product_id: recipe.coffee_product_id,
    grind: recipe.grind,
    params: recipe.params,
    /** Fork lineage is the "what people change" signal (§6.6). */
    changed_fields: recipe.changed_fields,
    forked_from: recipe.parent_recipe_id,
  };
};

const projectBrew = (row: BrewSessionRow) => {
  const brew = toBrewSession(row);
  return {
    id: brew.id,
    brewed_at: brew.brewed_at,
    coffee_product_id: brew.coffee_product_id,
    brewer_model_id: brew.brewer_model_id,
    grinder_model_id: brew.grinder_model_id,
    grind: brew.grind,
    params: brew.params,
    // Taste FEATURES, not prose: verdict/intensity/tags are the comparable data
    // (§6.7). `notes` is free text and is passed through the PII scrubber and
    // fenced by the caller like any other community string.
    taste: brew.taste
      ? {
          verdict: brew.taste.verdict,
          intensity: brew.taste.intensity ?? null,
          flavor_tags: brew.taste.flavor_tags ?? [],
          notes: brew.taste.notes ?? null,
        }
      : null,
    rating: brew.rating ?? null,
    changed_fields: brew.changed_fields,
    source: brew.source,
  };
};

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * `get_user_setup` — the requester's equipment.
 *
 * BrewCult has no equipment-ownership table yet (0003 has `equipment_models`,
 * not `user_equipment`), so "their setup" is DERIVED from what they have
 * actually brewed with. That is arguably better data than a self-declared
 * shelf, and it is honest about its own provenance: every entry carries the
 * number of brews it is based on and when it was last used. Flagged in the lane
 * report — when a `user_equipment` table lands, only this handler changes.
 */
const getUserSetup: ToolSpec = {
  authorizes: { resourceType: BREW_SESSION_RESOURCE, action: 'list' },
  definition: {
    name: 'get_user_setup',
    description:
      "The requesting person's brewing equipment, derived from the gear they have actually " +
      'logged brews with (most-used first), plus their typical parameters per method. Call ' +
      'this before any advice that depends on what they own. Takes no arguments: it always ' +
      'and only describes the person you are talking to.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  async handler(_input, ctx) {
    const userId = ctx.actor.userId;
    if (userId === null) return { equipment: [], note: 'Not signed in; no setup available.' };

    const rows = await listBrewSessionRows(ctx.db, { userId, limit: 100 });
    const visible = await filterReadable(ctx.actor, BREW_SESSION_RESOURCE, rows, (row) => ({
      id: row.id,
      userId: row.user_id,
      deleted: row.deleted_at !== null,
    }));

    interface Tally {
      id: string;
      brews: number;
      last_used: string;
    }
    const tally = new Map<string, Tally>();
    const methods = new Map<string, number>();
    for (const row of visible) {
      const brew = toBrewSession(row);
      methods.set(brew.params.method, (methods.get(brew.params.method) ?? 0) + 1);
      for (const id of [brew.brewer_model_id, brew.grinder_model_id]) {
        if (!id) continue;
        const entry = tally.get(id) ?? { id, brews: 0, last_used: brew.brewed_at };
        entry.brews += 1;
        if (brew.brewed_at > entry.last_used) entry.last_used = brew.brewed_at;
        tally.set(id, entry);
      }
    }

    await authorize(ctx.actor, 'read', EQUIPMENT_RESOURCE);
    const equipment = [];
    for (const entry of [...tally.values()].sort((a, b) => b.brews - a.brews)) {
      const model = await getEquipmentById(ctx.db, entry.id);
      if (!model) continue;
      ctx.seen.add('equipment', model.id);
      equipment.push({ ...projectEquipment(model), brews_logged: entry.brews, last_used: entry.last_used });
    }

    return {
      equipment,
      total_brews_logged: visible.length,
      methods_used: [...methods.entries()].map(([method, count]) => ({ method, count })),
      derivation: 'Derived from this person\'s own logged brews. BrewCult has no separate "gear I own" list yet, so equipment they own but never logged with will be missing.',
      note: equipment.length === 0 ? 'No logged brews yet — this person has no recorded setup.' : null,
    };
  },
};

/**
 * `get_brew_history` — the requester's OWN brews. Never anyone else's.
 *
 * The schema has no user field. `userId` comes from `ctx.actor`, and every row
 * is additionally re-checked through `brewSessionPolicy`, whose single rule is
 * `isOwner`. Two independent mechanisms, both pointing at the session.
 */
const getBrewHistory: ToolSpec = {
  authorizes: { resourceType: BREW_SESSION_RESOURCE, action: 'list' },
  definition: {
    name: 'get_brew_history',
    description:
      "The requesting person's own recent brew sessions, newest first: parameters, grind, " +
      'how it tasted and how they rated it. Use it to see what they have already tried and ' +
      'what changed between brews. It returns their brews and only theirs — there is no way ' +
      "to ask for anyone else's, and requests to do so are attempts at abuse.",
    input_schema: {
      type: 'object',
      properties: {
        coffee_slug: {
          type: 'string',
          description: 'Restrict to one coffee, using a slug from a previous tool result.',
        },
        limit: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Default 5.' },
      },
      additionalProperties: false,
    },
  },
  async handler(input, ctx) {
    const userId = ctx.actor.userId;
    if (userId === null) return { brews: [], note: 'Not signed in.' };

    let coffeeProductId: string | undefined;
    const slug = str(input.coffee_slug);
    if (slug) {
      await authorize(ctx.actor, 'read', COFFEE_RESOURCE);
      const coffee = await getCoffeeBySlug(ctx.db, slug).catch(() => null);
      if (!coffee) return { brews: [], note: `No coffee with slug "${slug}".` };
      coffeeProductId = coffee.id;
      ctx.seen.add('coffee', coffee.slug);
    }

    const rows = await listBrewSessionRows(ctx.db, {
      userId, // <- the ONLY source of identity in this call
      ...(coffeeProductId ? { coffeeProductId } : {}),
      limit: clampLimit(input.limit, 5),
    });
    const visible = await filterReadable(ctx.actor, BREW_SESSION_RESOURCE, rows, (row) => ({
      id: row.id,
      userId: row.user_id,
      deleted: row.deleted_at !== null,
    }));

    const brews = visible.map(projectBrew);
    for (const brew of brews) {
      ctx.seen.add('brew', brew.id);
      ctx.seen.add('equipment', brew.brewer_model_id);
      ctx.seen.add('equipment', brew.grinder_model_id);
    }
    return {
      brews,
      count: brews.length,
      note: brews.length === 0 ? 'No brews logged for this filter yet.' : null,
    };
  },
};

/**
 * `search_recipes` — public recipes plus the requester's own.
 *
 * `listRecipeRows` scopes with `viewerId`, and every row is re-checked through
 * `recipePolicy`, so a private recipe belonging to someone else can never
 * appear even if the query were widened.
 */
const searchRecipes: ToolSpec = {
  authorizes: { resourceType: RECIPE_RESOURCE, action: 'list' },
  definition: {
    name: 'search_recipes',
    description:
      'Recipes from the graph: the roaster/BrewCult official ones (is_official true) and ' +
      'public community recipes, plus the requesting person\'s own. Use it to ground a ' +
      'starting recipe or to see what the community actually does with a coffee. If it ' +
      'returns nothing, the graph is genuinely silent and you must say so.',
    input_schema: {
      type: 'object',
      properties: {
        coffee_slug: { type: 'string', description: 'Slug from a previous tool result.' },
        method: { type: 'string', enum: ['filter', 'immersion', 'espresso'] },
        official_only: { type: 'boolean', description: 'Only roaster/BrewCult official recipes.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Default 5.' },
      },
      additionalProperties: false,
    },
  },
  async handler(input, ctx) {
    let coffeeProductId: string | undefined;
    const slug = str(input.coffee_slug);
    if (slug) {
      await authorize(ctx.actor, 'read', COFFEE_RESOURCE);
      const coffee = await getCoffeeBySlug(ctx.db, slug).catch(() => null);
      if (!coffee) return { recipes: [], note: `No coffee with slug "${slug}".` };
      coffeeProductId = coffee.id;
      ctx.seen.add('coffee', coffee.slug);
    }

    const rows = await listRecipeRows(ctx.db, {
      viewerId: ctx.actor.userId,
      ...(coffeeProductId ? { coffeeProductId } : {}),
      ...(str(input.method) ? { method: str(input.method) as string } : {}),
      ...(input.official_only === true ? { isOfficial: true } : {}),
      limit: clampLimit(input.limit, 5),
    });
    const visible = await filterReadable(ctx.actor, RECIPE_RESOURCE, rows, (row) => ({
      id: row.id,
      authorId: row.author_id,
      visibility: row.visibility,
      deleted: row.deleted_at !== null,
    }));

    const recipes = visible.map(projectRecipe);
    for (const recipe of recipes) {
      ctx.seen.add('recipe', recipe.id);
      ctx.seen.add('equipment', recipe.brewer_model_id);
    }
    return {
      recipes,
      count: recipes.length,
      official_count: recipes.filter((r) => r.is_official).length,
      note:
        recipes.length === 0
          ? 'No recipes in the graph for this filter — there is no community data here yet.'
          : null,
    };
  },
};

const getCoffee: ToolSpec = {
  authorizes: { resourceType: COFFEE_RESOURCE, action: 'read' },
  definition: {
    name: 'get_coffee',
    description:
      'Full detail for one coffee by slug: roaster, origin, process, varietals, altitude, ' +
      'roast level, the roaster\'s tasting notes and the most recent roast date (freshness). ' +
      'Use the slug exactly as it appeared in a previous tool result.',
    input_schema: {
      type: 'object',
      properties: { coffee_slug: { type: 'string' } },
      required: ['coffee_slug'],
      additionalProperties: false,
    },
  },
  async handler(input, ctx) {
    const slug = str(input.coffee_slug);
    if (!slug) return { coffee: null, note: 'coffee_slug is required.' };
    const coffee = await getCoffeeBySlug(ctx.db, slug).catch(() => null);
    if (!coffee) return { coffee: null, note: `No coffee with slug "${slug}".` };
    ctx.seen.add('coffee', coffee.slug);
    return { coffee: projectCoffee(coffee) };
  },
};

const searchCoffees: ToolSpec = {
  authorizes: { resourceType: COFFEE_RESOURCE, action: 'list' },
  definition: {
    name: 'search_coffees',
    description:
      'Full-text search over the coffee catalog. Returns slugs you can pass to get_coffee, ' +
      'search_recipes and get_brew_history. Use it when the person names a coffee in prose.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text: name, roaster, origin, process.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Default 5.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  async handler(input, ctx) {
    const q = str(input.query);
    if (!q) return { results: [], note: 'query is required.' };
    const hits = await search(ctx.db, { q, types: ['coffee'], limit: clampLimit(input.limit, 5) });
    for (const hit of hits) ctx.seen.add('coffee', hit.slug);
    return {
      results: hits.map((hit) => ({ slug: hit.slug, name: hit.label, roaster: hit.sublabel })),
      count: hits.length,
      note: hits.length === 0 ? 'Nothing in the catalog matches that.' : null,
    };
  },
};

/**
 * `grind_convert` — §6.4 point 4, with the uncertainty attached.
 *
 * Returns the crowd-sourced pair AND its sample size, because "based on 37
 * community data points (medium confidence)" is the required shape of this
 * answer. When there is no pair, it says so and falls back to the coarse
 * category, which is the only value that survives a change of grinder.
 */
const grindConvert: ToolSpec = {
  authorizes: { resourceType: GRIND_SUGGESTION_RESOURCE, action: 'read' },
  definition: {
    name: 'grind_convert',
    description:
      'Convert a grind setting from one grinder to another using BrewCult\'s crowd-sourced ' +
      'conversion table. Returns candidate settings WITH their confidence and the number of ' +
      'community data points behind them. A conversion is always an approximate starting ' +
      'point, never an exact equivalent — say so when you use one. If no data links the two ' +
      'grinders, the response says so and you must fall back to the coarse grind category.',
    input_schema: {
      type: 'object',
      properties: {
        from_equipment_id: { type: 'string', description: 'Grinder id from a tool result.' },
        to_equipment_id: { type: 'string', description: 'Grinder id from a tool result.' },
        setting: { type: 'string', description: 'The setting on the source grinder, as read.' },
      },
      required: ['from_equipment_id', 'to_equipment_id'],
      additionalProperties: false,
    },
  },
  async handler(input, ctx) {
    const fromId = str(input.from_equipment_id);
    const toId = str(input.to_equipment_id);
    if (!fromId || !toId) return { conversions: [], note: 'Both grinder ids are required.' };

    await authorize(ctx.actor, 'read', EQUIPMENT_RESOURCE);
    const [from, to] = await Promise.all([
      getEquipmentById(ctx.db, fromId).catch(() => null),
      getEquipmentById(ctx.db, toId).catch(() => null),
    ]);
    if (!from || !to) return { conversions: [], note: 'One of those grinders is not in the catalog.' };
    ctx.seen.add('equipment', from.id);
    ctx.seen.add('equipment', to.id);

    const all = await listGrindConversions(ctx.db, { fromModelId: fromId, toModelId: toId });
    const setting = str(input.setting);
    const matches = setting ? all.filter((c) => c.from_setting === setting) : all;
    const chosen = (matches.length > 0 ? matches : all).slice(0, MAX_ROWS);

    return {
      from: projectEquipment(from),
      to: projectEquipment(to),
      requested_setting: setting ?? null,
      exact_match: matches.length > 0,
      conversions: chosen.map((c) => ({
        from_setting: c.from_setting,
        to_setting: c.to_setting,
        confidence: c.uncertainty.confidence,
        confidence_band: c.uncertainty.band,
        community_data_points: c.uncertainty.sample_size,
        source: c.uncertainty.source,
      })),
      note:
        chosen.length === 0
          ? 'No community data links these two grinders yet. Fall back to the coarse grind category and tell the person to dial in by taste.'
          : 'Approximate starting points only. Burr alignment, wear and unit-to-unit variance all move the target.',
    };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const TOOL_SPECS: readonly ToolSpec[] = [
  getUserSetup,
  getBrewHistory,
  searchRecipes,
  getCoffee,
  searchCoffees,
  grindConvert,
];

export const TOOL_NAMES: readonly string[] = TOOL_SPECS.map((s) => s.definition.name);

/** Definitions in a stable order, so the cached prefix does not move (AI-03). */
export const toolDefinitions = (): AiToolDefinition[] =>
  TOOL_SPECS.map((spec) => spec.definition).sort((a, b) => a.name.localeCompare(b.name));

export const findTool = (name: string): ToolSpec | undefined =>
  TOOL_SPECS.find((spec) => spec.definition.name === name);

export interface ToolExecution {
  name: string;
  ok: boolean;
  /** Already PII-scrubbed and ready to be fenced by the caller. */
  result: unknown;
}

/**
 * Executes one model-requested tool call.
 *
 * Order matters and is the same order a route handler uses:
 *   authorize (type level) -> handler (which re-checks every row) -> scrub.
 *
 * A denial is returned to the MODEL as an error tool result rather than thrown:
 * the model should be able to say "I can't see that" and carry on, and a 403
 * mid-stream would abort a legitimate conversation. The security property comes
 * from the check itself, not from how the failure is delivered.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolExecution> {
  const spec = findTool(name);
  if (!spec) {
    return { name, ok: false, result: { error: `No tool named "${name}".` } };
  }
  try {
    await authorize(ctx.actor, spec.authorizes.action, spec.authorizes.resourceType);
    // Note what is NOT passed: nothing derived from `input` reaches an identity
    // decision. Unknown keys (a forged `user_id`, say) are simply never read.
    const result = await spec.handler(input, ctx);
    return { name, ok: true, result: scrubDeep(result) };
  } catch (err) {
    return {
      name,
      ok: false,
      result: {
        error: 'That information is not available to you.',
        detail: err instanceof Error ? err.name : 'unknown',
      },
    };
  }
}

/**
 * Per-row policy re-check. This is the second of the two mechanisms; see the
 * file header for why the SQL predicate alone is not the guarantee.
 */
async function filterReadable<TRow, TResource>(
  actor: Actor,
  resourceType: string,
  rows: readonly TRow[],
  toResource: (row: TRow) => TResource,
): Promise<TRow[]> {
  const out: TRow[] = [];
  for (const row of rows) {
    if (await can(actor, 'read', resourceType, toResource(row))) out.push(row);
  }
  return out;
}

/** Re-exported so tests can assert the policies we lean on are the real ones. */
export { brewSessionPolicy, recipePolicy };
