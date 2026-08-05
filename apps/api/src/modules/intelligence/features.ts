/**
 * The three Brew Intelligence features — AI-04, AI-05, AI-06 (§7.1).
 *
 * Everything here follows one shape:
 *
 *   authorize -> gather grounding THROUGH THE TOOL LAYER -> assemble prompt
 *   -> gateway (budget-checked) -> parse -> sanitize + allowlist -> DTO
 *
 * The "through the tool layer" step is not decoration. `diagnose` and
 * `starting_recipe` do not stream a tool loop, but they still gather their
 * grounding by calling `executeTool(...)` with the requester's `ToolContext` —
 * so all three features read the graph through the identical authorization
 * path, and the IDOR proof in the test suite covers all three at once.
 *
 * `chat` runs the real loop: while `stop_reason === 'tool_use'`, append the
 * assistant message, execute every requested tool, and send ALL tool_result
 * blocks back in ONE user message.
 */

import { badRequest, notFound } from '../../lib/errors.js';
import { authorize, type Actor } from '../../lib/policy.js';
import {
  BREW_SESSION_RESOURCE,
  findBrewSessionResource,
  getBrewSessionRow,
  toBrewSession,
} from '../brewing/index.js';
import type { AiGateway } from './gateway.js';
import { resolveOutput } from './output.js';
import { AI_ASSISTANT_RESOURCE } from './policies.js';
import { assemble, UntrustedFence, type AssembleInput } from './prompts/index.js';
import { SeenEntities, executeTool, toolDefinitions, type ToolContext } from './tools/index.js';
import type {
  AiContentBlock,
  AiMessage,
  AiPlan,
  DiagnoseResult,
  GroundingReport,
  IntelligenceDb,
  StartingRecipeResult,
} from './types.js';

export interface FeatureDeps {
  gateway: AiGateway;
  db: IntelligenceDb;
  plan?: AiPlan;
}

// ---------------------------------------------------------------------------
// Structured-output schemas (output_config.format — NOT the deprecated
// top-level output_format)
// ---------------------------------------------------------------------------

const GROUNDING_FIELDS = {
  basis: {
    type: 'string',
    enum: ['roaster_official_recipe', 'community_recipes', 'user_brew_history', 'general_priors'],
    description: 'Which basis the answer actually stands on. Never overstate it.',
  },
  sample_size: { type: 'integer', minimum: 0, description: 'Graph rows behind the answer.' },
  grounding_note: {
    type: 'string',
    description:
      'One sentence naming the basis in plain language. When basis is general_priors this MUST say there is no community data yet.',
  },
} as const;

export const DIAGNOSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'diagnosis',
    'variable',
    'direction',
    'target',
    'confidence',
    'basis',
    'sample_size',
    'grounding_note',
    'advice_markdown',
    'reasoning_markdown',
  ],
  properties: {
    diagnosis: {
      type: 'string',
      enum: ['under_extracted', 'over_extracted', 'balanced', 'unclear'],
    },
    // The schema itself enforces §7.2 rule 2: one variable, one direction.
    variable: {
      type: 'string',
      enum: ['grind', 'temperature', 'time', 'ratio', 'dose', 'agitation', 'none'],
      description: 'The SINGLE variable to change. "none" means hold.',
    },
    direction: {
      type: 'string',
      enum: ['finer', 'coarser', 'hotter', 'cooler', 'longer', 'shorter', 'more', 'less', 'hold'],
    },
    target: { type: ['string', 'null'], description: 'Concrete new value, when one is knowable.' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    ...GROUNDING_FIELDS,
    advice_markdown: { type: 'string', description: 'What to do. Markdown, no HTML.' },
    reasoning_markdown: { type: 'string', description: 'Why — the §7.1 "explanation on demand".' },
  },
};

export const STARTING_RECIPE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'method',
    'dose_g',
    'water_g',
    'temperature_c',
    'brew_time_s',
    'grind_category',
    'grind_setting',
    'confidence',
    'basis',
    'sample_size',
    'grounding_note',
    'rationale_markdown',
  ],
  properties: {
    method: { type: 'string', enum: ['filter', 'immersion', 'espresso'] },
    dose_g: { type: ['number', 'null'] },
    water_g: { type: ['number', 'null'] },
    temperature_c: { type: ['number', 'null'] },
    brew_time_s: { type: ['number', 'null'] },
    grind_category: {
      type: 'string',
      enum: ['extra_fine', 'fine', 'medium_fine', 'medium', 'medium_coarse', 'coarse'],
      description: 'Always required — the only value that survives a change of grinder (§6.4).',
    },
    grind_setting: {
      type: ['string', 'null'],
      description: 'Only when a tool gave you one for this exact grinder. Otherwise null.',
    },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    ...GROUNDING_FIELDS,
    rationale_markdown: { type: 'string' },
  },
};

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

function newContext(actor: Actor, db: IntelligenceDb, fence = new UntrustedFence()): ToolContext {
  return { actor, db, fence, seen: new SeenEntities() };
}

/** Pulls the first text block out of a response and JSON-parses it. */
function parseStructured(content: AiContentBlock[]): Record<string, unknown> {
  const text = content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') {
    throw badRequest('The model returned no answer. Try again.');
  }
  const start = text.text.indexOf('{');
  const end = text.text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw badRequest('The model returned an unusable answer. Try again.');
  }
  try {
    return JSON.parse(text.text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw badRequest('The model returned an unusable answer. Try again.');
  }
}

const asString = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asConfidence = (v: unknown): 'low' | 'medium' | 'high' =>
  v === 'high' || v === 'medium' ? v : 'low';

function groundingOf(payload: Record<string, unknown>, fallback: GroundingReport): GroundingReport {
  const basis = payload.basis;
  return {
    basis:
      basis === 'roaster_official_recipe' ||
      basis === 'community_recipes' ||
      basis === 'user_brew_history' ||
      basis === 'general_priors'
        ? basis
        : fallback.basis,
    sample_size: asNumber(payload.sample_size) ?? fallback.sample_size,
    note: asString(payload.grounding_note, fallback.note),
  };
}

/** Runs one tool by name for server-side grounding. Never throws. */
async function ground(
  ctx: ToolContext,
  name: string,
  input: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const execution = await executeTool(name, input, ctx);
  return (execution.result ?? {}) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// AI-06 — dial-in diagnosis
// ---------------------------------------------------------------------------

export interface DiagnoseInput {
  brew_session_id: string;
  /** Optional: the coffee's catalog slug, so community grounding can be pulled. */
  coffee_slug?: string;
  /** Optional free-text follow-up from the person. */
  question?: string;
}

export async function diagnose(
  actor: Actor,
  input: DiagnoseInput,
  deps: FeatureDeps,
): Promise<DiagnoseResult> {
  await authorize(actor, 'create', AI_ASSISTANT_RESOURCE);
  const userId = actor.userId;
  if (userId === null) throw badRequest('Authentication required.');

  // Load the POLICY RESOURCE first and authorize against the stored row, exactly
  // as a brewing route would. The model never sees a session it does not own.
  const resource = await findBrewSessionResource(deps.db, input.brew_session_id);
  if (!resource) throw notFound('Brew session not found.');
  await authorize(actor, 'read', BREW_SESSION_RESOURCE, resource);

  const row = await getBrewSessionRow(deps.db, input.brew_session_id);
  if (!row) throw notFound('Brew session not found.');
  const brew = toBrewSession(row);

  const ctx = newContext(actor, deps.db);
  ctx.seen.add('brew', brew.id);
  ctx.seen.add('equipment', brew.brewer_model_id);
  ctx.seen.add('equipment', brew.grinder_model_id);

  const setup = await ground(ctx, 'get_user_setup');
  const history = await ground(ctx, 'get_brew_history', {
    ...(input.coffee_slug ? { coffee_slug: input.coffee_slug } : {}),
    limit: 5,
  });
  const recipes = input.coffee_slug
    ? await ground(ctx, 'search_recipes', { coffee_slug: input.coffee_slug, limit: 3 })
    : { recipes: [], count: 0 };

  const historyCount = asNumber(history.count) ?? 0;
  const fallbackGrounding: GroundingReport = {
    basis: historyCount > 1 ? 'user_brew_history' : 'general_priors',
    sample_size: historyCount,
    note:
      historyCount > 1
        ? `Based on ${historyCount} of your own logged brews with this setup.`
        : 'No community data for this combination yet — this is a general starting point.',
  };

  // Taste FEATURES, never prose, in the trusted context block (AI-09).
  const context = {
    brew: {
      params: brew.params,
      grind: brew.grind,
      taste: brew.taste
        ? {
            verdict: brew.taste.verdict,
            intensity: brew.taste.intensity ?? null,
            flavor_tags: brew.taste.flavor_tags ?? [],
          }
        : null,
      rating: brew.rating ?? null,
      changed_fields: brew.changed_fields,
      source: brew.source,
    },
    setup,
    recent_brews: history.brews ?? [],
    community_recipes_for_this_coffee: asNumber(recipes.count) ?? 0,
    grounding: fallbackGrounding,
  };

  // Free text goes in the UNTRUSTED channel — including the person's own notes.
  const untrusted: AssembleInput['untrusted'] = [];
  if (brew.taste?.notes) {
    untrusted.push({ source: 'brew_notes', content: brew.taste.notes, meta: { brew_id: brew.id } });
  }
  for (const recipe of (recipes.recipes ?? []) as { id?: string; title?: string }[]) {
    if (recipe.title) {
      untrusted.push({
        source: 'recipe_title',
        content: recipe.title,
        meta: { recipe_id: recipe.id ?? '' },
      });
    }
  }

  const prompt = assemble({
    feature: 'diagnose',
    context,
    untrusted,
    question:
      input.question ??
      'Diagnose this brew and give me exactly one thing to change on the next one.',
    fence: ctx.fence,
  });

  const result = await deps.gateway.complete({
    feature: 'diagnose',
    userId,
    plan: deps.plan ?? 'free',
    system: prompt.system,
    messages: prompt.messages,
    jsonSchema: DIAGNOSE_SCHEMA,
  });

  const payload = parseStructured(result.content);
  const advice = await resolveOutput(asString(payload.advice_markdown, ''), {
    db: deps.db,
    actor,
    seen: ctx.seen,
  });
  const reasoning = await resolveOutput(asString(payload.reasoning_markdown, ''), {
    db: deps.db,
    actor,
    seen: ctx.seen,
  });

  const diagnosisValue = payload.diagnosis;
  return {
    diagnosis:
      diagnosisValue === 'under_extracted' ||
      diagnosisValue === 'over_extracted' ||
      diagnosisValue === 'balanced'
        ? diagnosisValue
        : 'unclear',
    suggestion: {
      variable: asVariable(payload.variable),
      direction: asDirection(payload.direction),
      target: typeof payload.target === 'string' ? payload.target : null,
    },
    advice_markdown: advice.text,
    reasoning_markdown: reasoning.text,
    confidence: asConfidence(payload.confidence),
    grounding: groundingOf(payload, fallbackGrounding),
    entities: dedupe([...advice.entities, ...reasoning.entities]),
    usage: result.report,
  };
}

// ---------------------------------------------------------------------------
// AI-05 — starting recipe
// ---------------------------------------------------------------------------

export interface StartingRecipeInput {
  coffee_slug: string;
  method?: 'filter' | 'immersion' | 'espresso';
  question?: string;
}

export async function startingRecipe(
  actor: Actor,
  input: StartingRecipeInput,
  deps: FeatureDeps,
): Promise<StartingRecipeResult> {
  await authorize(actor, 'create', AI_ASSISTANT_RESOURCE);
  const userId = actor.userId;
  if (userId === null) throw badRequest('Authentication required.');

  const ctx = newContext(actor, deps.db);

  const coffeeResult = await ground(ctx, 'get_coffee', { coffee_slug: input.coffee_slug });
  const coffee = coffeeResult.coffee as Record<string, unknown> | null | undefined;
  if (!coffee) throw notFound('Coffee not found.');

  const setup = await ground(ctx, 'get_user_setup');

  // §7.2/§7.1 basis order: roaster's official recipe -> community recipes for
  // this coffee (preferring the person's brewer) -> general priors.
  const official = await ground(ctx, 'search_recipes', {
    coffee_slug: input.coffee_slug,
    official_only: true,
    ...(input.method ? { method: input.method } : {}),
    limit: 3,
  });
  const community = await ground(ctx, 'search_recipes', {
    coffee_slug: input.coffee_slug,
    ...(input.method ? { method: input.method } : {}),
    limit: 5,
  });

  const officialRecipes = (official.recipes ?? []) as Record<string, unknown>[];
  const communityRecipes = (community.recipes ?? []) as Record<string, unknown>[];
  const brewerIds = new Set(
    ((setup.equipment ?? []) as { id?: string; category?: string }[])
      .filter((e) => e.category === 'brewer')
      .map((e) => e.id),
  );
  const preferred =
    officialRecipes[0] ??
    communityRecipes.find((r) => brewerIds.has(r.brewer_model_id as string)) ??
    communityRecipes[0] ??
    null;

  const basis: GroundingReport['basis'] =
    officialRecipes.length > 0
      ? 'roaster_official_recipe'
      : communityRecipes.length > 0
        ? 'community_recipes'
        : 'general_priors';
  const sampleSize =
    basis === 'roaster_official_recipe'
      ? officialRecipes.length
      : basis === 'community_recipes'
        ? communityRecipes.length
        : 0;

  const fallbackGrounding: GroundingReport = {
    basis,
    sample_size: sampleSize,
    note:
      basis === 'roaster_official_recipe'
        ? "Based on the roaster's official recipe for this coffee."
        : basis === 'community_recipes'
          ? `Based on ${sampleSize} community recipe${sampleSize === 1 ? '' : 's'} for this coffee.`
          : 'No community data for this coffee on your setup yet — this is a general starting point from similar coffees.',
  };

  const untrusted: AssembleInput['untrusted'] = [];
  const notes = coffee.tasting_notes;
  if (Array.isArray(notes) && notes.length > 0) {
    untrusted.push({
      source: 'coffee_tasting_notes',
      content: notes.join(', '),
      meta: { coffee_slug: String(coffee.slug ?? '') },
    });
  }
  for (const recipe of [...officialRecipes, ...communityRecipes]) {
    if (typeof recipe.title === 'string') {
      untrusted.push({
        source: 'recipe_title',
        content: recipe.title,
        meta: { recipe_id: String(recipe.id ?? '') },
      });
    }
  }

  const prompt = assemble({
    feature: 'starting_recipe',
    context: {
      coffee: { ...coffee, tasting_notes: undefined },
      requested_method: input.method ?? null,
      setup,
      grounding: { ...fallbackGrounding, seed_recipe: preferred },
    },
    untrusted,
    question:
      input.question ??
      'Give me a starting recipe for this coffee on my equipment, and say what it is based on.',
    fence: ctx.fence,
  });

  const result = await deps.gateway.complete({
    feature: 'starting_recipe',
    userId,
    plan: deps.plan ?? 'free',
    system: prompt.system,
    messages: prompt.messages,
    jsonSchema: STARTING_RECIPE_SCHEMA,
  });

  const payload = parseStructured(result.content);
  const rationale = await resolveOutput(asString(payload.rationale_markdown, ''), {
    db: deps.db,
    actor,
    seen: ctx.seen,
  });

  const dose = asNumber(payload.dose_g);
  const water = asNumber(payload.water_g);
  return {
    method: asString(payload.method, input.method ?? 'filter'),
    dose_g: dose,
    water_g: water,
    ratio: dose && water && dose > 0 ? Math.round((water / dose) * 100) / 100 : null,
    temperature_c: asNumber(payload.temperature_c),
    brew_time_s: asNumber(payload.brew_time_s),
    grind_category: asString(payload.grind_category, 'medium'),
    grind_setting: typeof payload.grind_setting === 'string' ? payload.grind_setting : null,
    rationale_markdown: rationale.text,
    confidence: asConfidence(payload.confidence),
    grounding: groundingOf(payload, fallbackGrounding),
    entities: rationale.entities,
    usage: result.report,
  };
}

// ---------------------------------------------------------------------------
// AI-04 — chat (tool-using, streamed)
// ---------------------------------------------------------------------------

export interface ChatInput {
  message: string;
  /** Prior turns as plain text; the server re-fences them on every request. */
  history?: { role: 'user' | 'assistant'; text: string }[];
}

export type ChatEvent =
  | { type: 'token'; text: string }
  | { type: 'tool'; name: string; ok: boolean }
  | {
      type: 'done';
      text: string;
      entities: DiagnoseResult['entities'];
      usage: DiagnoseResult['usage'];
    };

/** Bounded so a confused model cannot loop the budget away. */
export const MAX_TOOL_ITERATIONS = 4;

export async function* chat(
  actor: Actor,
  input: ChatInput,
  deps: FeatureDeps,
): AsyncGenerator<ChatEvent> {
  await authorize(actor, 'create', AI_ASSISTANT_RESOURCE);
  const userId = actor.userId;
  if (userId === null) throw badRequest('Authentication required.');

  const ctx = newContext(actor, deps.db);
  const setup = await ground(ctx, 'get_user_setup');

  const history: AiMessage[] = [];
  for (const turn of input.history ?? []) {
    history.push({
      role: turn.role,
      content: [
        {
          type: 'text',
          // Assistant turns are re-fenced too: an earlier answer is not an
          // instruction for this one, and history can be client-supplied.
          text: ctx.fence.wrap(turn.role === 'user' ? 'user_message' : 'post_body', turn.text),
        },
      ],
    });
  }

  const prompt = assemble({
    feature: 'chat',
    tools: toolDefinitions(),
    context: { setup },
    question: input.message,
    history,
    fence: ctx.fence,
  });

  const messages: AiMessage[] = [...prompt.messages];
  let finalText = '';
  let usage = null as DiagnoseResult['usage'] | null;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    let streamed = '';
    let result: Awaited<ReturnType<AiGateway['complete']>> | null = null;

    for await (const event of deps.gateway.stream({
      feature: 'chat',
      userId,
      plan: deps.plan ?? 'free',
      system: prompt.system,
      tools: prompt.tools,
      messages,
    })) {
      if (event.type === 'text_delta') {
        streamed += event.text;
        yield { type: 'token', text: event.text };
      } else {
        result = event.result;
      }
    }
    if (!result) throw badRequest('The assistant did not answer. Try again.');
    usage = result.report;

    if (result.stop_reason !== 'tool_use') {
      finalText = streamed || textOf(result.content);
      break;
    }

    // Tool-use turn: append the assistant message, then send EVERY tool_result
    // back in ONE user message.
    messages.push({ role: 'assistant', content: result.content });
    const results: AiContentBlock[] = [];
    for (const block of result.content) {
      if (block.type !== 'tool_use') continue;
      const execution = await executeTool(block.name, block.input, ctx);
      yield { type: 'tool', name: block.name, ok: execution.ok };
      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: ctx.fence.wrapToolResult(block.name, JSON.stringify(execution.result)),
        ...(execution.ok ? {} : { is_error: true }),
      });
    }
    if (results.length === 0) {
      finalText = streamed || textOf(result.content);
      break;
    }
    messages.push({ role: 'user', content: results });
  }

  const resolved = await resolveOutput(finalText, { db: deps.db, actor, seen: ctx.seen });
  yield {
    type: 'done',
    text: resolved.text,
    entities: resolved.entities,
    usage: usage ?? {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      daily_tokens_used: 0,
      daily_token_limit: 0,
      daily_tokens_remaining: 0,
    },
  };
}

// ---------------------------------------------------------------------------

const textOf = (content: AiContentBlock[]): string =>
  content
    .filter((b): b is Extract<AiContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

const dedupe = (entities: DiagnoseResult['entities']): DiagnoseResult['entities'] => {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    const key = `${entity.type}:${entity.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const VARIABLES = ['grind', 'temperature', 'time', 'ratio', 'dose', 'agitation', 'none'] as const;
const DIRECTIONS = [
  'finer',
  'coarser',
  'hotter',
  'cooler',
  'longer',
  'shorter',
  'more',
  'less',
  'hold',
] as const;

const asVariable = (v: unknown): DiagnoseResult['suggestion']['variable'] =>
  typeof v === 'string' && (VARIABLES as readonly string[]).includes(v)
    ? (v as DiagnoseResult['suggestion']['variable'])
    : 'none';

const asDirection = (v: unknown): DiagnoseResult['suggestion']['direction'] =>
  typeof v === 'string' && (DIRECTIONS as readonly string[]).includes(v)
    ? (v as DiagnoseResult['suggestion']['direction'])
    : 'hold';
