/**
 * Brew Intelligence client (second_draft §7, EF §3.4).
 *
 * Three endpoints, one philosophy: **the AI is a guest on the page, never the
 * page**. Every call here is allowed to fail — the surfaces that use it render
 * less, never nothing, and never an exception (§7.2: uncertainty is spoken, and
 * "the graph is silent" is a valid, honest answer).
 *
 * Contract with Lane O (in flight — read tolerantly, every field optional):
 *   POST /api/v1/ai/diagnose        { brew_session_id }
 *        -> { advice, variable, direction, confidence, basis, entities[] }
 *   POST /api/v1/ai/starting-recipe { coffee_product_id, brewer_model_id?, grinder_model_id? }
 *        -> { recipe, basis, entities[] }
 *   POST /api/v1/ai/chat            SSE stream, tool-using
 *
 * Two rules this module exists to enforce:
 *  1. **Nothing model-authored becomes a link.** Entity references resolve from
 *     the API's `entities[]` through the allowlist in {@link entityHref} — never
 *     from URLs the model wrote in prose (EF §3.4: allowlist lookup, and a model
 *     that can mint links is a phishing surface).
 *  2. **A shape we do not recognise renders as nothing**, not as raw JSON. Every
 *     normaliser below drops what it cannot name.
 *
 * Transport reuses lib/api.ts (`apiFetch` for JSON, `resolveApiUrl` + the same
 * cookie/CSRF/refresh dance for the stream, which cannot go through `apiFetch`
 * because that parses a JSON body). This module never forks the error envelope.
 */
import {
  ApiError,
  apiFetch,
  resolveApiUrl,
  type ApiRequestOptions,
  type FetchLike,
} from './api';

export const AI_PATHS = {
  diagnose: '/api/v1/ai/diagnose',
  startingRecipe: '/api/v1/ai/starting-recipe',
  chat: '/api/v1/ai/chat',
} as const;

/* ------------------------------------------------------------------ *
 * Tolerant readers — the contract is in flight, so nothing is trusted
 * ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** First non-empty string among the given keys. */
function pickText(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const found = asText(source[key]);
    if (found !== null) return found;
  }
  return null;
}

function pickNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const found = asNumber(source[key]);
    if (found !== null) return found;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Entities — the only thing allowed to become a link
 * ------------------------------------------------------------------ */

export type AiEntityType = 'coffee' | 'roaster' | 'equipment' | 'recipe';

export interface AiEntity {
  type: AiEntityType;
  name: string;
  slug: string | null;
  id: string | null;
}

/** Wire type → our four. Anything unknown is dropped, not guessed. */
const ENTITY_TYPE_ALIASES: Record<string, AiEntityType> = {
  coffee: 'coffee',
  coffee_product: 'coffee',
  coffee_products: 'coffee',
  roaster: 'roaster',
  equipment: 'equipment',
  equipment_model: 'equipment',
  brewer: 'equipment',
  grinder: 'equipment',
  recipe: 'recipe',
};

export function normalizeEntity(raw: unknown): AiEntity | null {
  const record = asRecord(raw);
  if (!record) return null;

  const rawType = pickText(record, ['type', 'entity_type', 'kind'])?.toLowerCase();
  const type = rawType ? ENTITY_TYPE_ALIASES[rawType] : undefined;
  if (!type) return null;

  const name = pickText(record, ['name', 'label', 'title', 'display_name']);
  if (!name) return null;

  const slug = pickText(record, ['slug']);
  const id = pickText(record, ['id', 'entity_id']);
  // A reference we cannot resolve to a real page is not an entity, it is prose.
  if (!slug && !id) return null;

  return { type, name, slug, id };
}

export function normalizeEntities(raw: unknown): AiEntity[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: AiEntity[] = [];
  for (const item of raw) {
    const entity = normalizeEntity(item);
    if (!entity) continue;
    const key = `${entity.type}:${entity.slug ?? entity.id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entity);
  }
  return out;
}

/**
 * The allowlist (EF §3.4). Returns `null` for anything that does not map onto a
 * real BrewCult route — the caller then renders the name as plain text.
 */
export function entityHref(entity: AiEntity): string | null {
  const encode = (value: string) => encodeURIComponent(value);
  switch (entity.type) {
    case 'coffee':
      return entity.slug ? `/coffee/${encode(entity.slug)}` : null;
    case 'roaster':
      return entity.slug ? `/roaster/${encode(entity.slug)}` : null;
    case 'equipment':
      return entity.slug ? `/equipment/${encode(entity.slug)}` : null;
    case 'recipe':
      return entity.id ? `/recipes/${encode(entity.id)}` : null;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Basis — "how much do I actually know?", said out loud (§7.2.1/3)
 * ------------------------------------------------------------------ */

export interface AiBasis {
  /** A sentence the API wrote. Preferred over anything we assemble. */
  label: string | null;
  kind: string | null;
  /** How many of *the user's own* brews fed the answer. */
  brewCount: number | null;
  /** How many community brews/recipes fed it. */
  communityCount: number | null;
}

export function normalizeBasis(raw: unknown): AiBasis | null {
  const asString = asText(raw);
  if (asString) return { label: asString, kind: null, brewCount: null, communityCount: null };

  const record = asRecord(raw);
  if (!record) return null;

  return {
    label: pickText(record, ['label', 'text', 'summary', 'description']),
    kind: pickText(record, ['kind', 'source', 'type']),
    brewCount: pickNumber(record, ['brew_count', 'user_brew_count', 'session_count', 'brews']),
    communityCount: pickNumber(record, [
      'community_brew_count',
      'community_count',
      'recipe_count',
      'community_recipes',
    ]),
  };
}

const NO_DATA_LINE =
  'No community data for this coffee yet — this is a general starting point.';

/**
 * Honest provenance in one line. Never inflates: with nothing to stand on it
 * says so, which §7.2 treats as a feature and not an apology.
 */
export function describeBasis(basis: AiBasis | null): string {
  if (!basis) return NO_DATA_LINE;
  if (basis.label) return basis.label;

  const mine = basis.brewCount ?? 0;
  const theirs = basis.communityCount ?? 0;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  if (mine > 0 && theirs > 0) {
    return `Based on your ${plural(mine, 'brew')} of this coffee and ${plural(
      theirs,
      'community brew',
    )}.`;
  }
  if (mine > 0) return `Based on your ${plural(mine, 'brew')} of this coffee.`;
  if (theirs > 0) return `Based on ${plural(theirs, 'community brew')} of this coffee.`;
  return NO_DATA_LINE;
}

/* ------------------------------------------------------------------ *
 * Confidence — calibrated language, never a percentage badge
 * ------------------------------------------------------------------ */

export type AiConfidence = 'low' | 'medium' | 'high';

export function normalizeConfidence(raw: unknown): AiConfidence | null {
  const text = asText(raw)?.toLowerCase();
  if (text === 'low' || text === 'medium' || text === 'high') return text;
  if (text === 'moderate') return 'medium';
  const value = asNumber(raw);
  if (value === null) return null;
  if (value < 0.34) return 'low';
  if (value < 0.67) return 'medium';
  return 'high';
}

/** Spoken uncertainty (§7.2.3). Silence for `high` — confidence needs no caveat. */
export function confidenceLine(confidence: AiConfidence | null): string | null {
  switch (confidence) {
    case 'low':
      return "I'm guessing more than usual here — worth a try, not a rule.";
    case 'medium':
      return 'Fairly confident, though your palate is the final word.';
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Failure classification — a dead AI is never an error message
 * ------------------------------------------------------------------ */

export const AI_BUDGET_MESSAGE =
  "You've used today's AI allowance — it resets tomorrow. Everything else still works.";

export type AiFailure =
  /** Not deployed, not reachable, or nothing to say. Render the page without it. */
  | { kind: 'unavailable' }
  /** Daily token budget spent (429). Honest, never punitive. */
  | { kind: 'budget'; message: string }
  /** Something the user may be able to act on (sign in again, retry). */
  | { kind: 'error'; message: string };

export function classifyAiError(error: unknown): AiFailure {
  if (error instanceof ApiError) {
    // 0 = network. 404/501 = Lane O hasn't shipped it. 503 = catching its breath.
    if (error.status === 0 || error.status === 404 || error.status === 501 || error.status === 503) {
      return { kind: 'unavailable' };
    }
    if (error.status === 429) {
      // The API is asked to send friendly copy. Anything that is actually a
      // sentence wins; a bare error code, a throttling boilerplate, or nothing
      // at all falls back to ours — the user must never read "rate_limited".
      const fromServer = asText(error.message);
      const isSentence =
        fromServer !== null &&
        fromServer !== error.code &&
        /\s/.test(fromServer) &&
        !/rate.?limit|too many/i.test(fromServer);
      return { kind: 'budget', message: isSentence ? fromServer : AI_BUDGET_MESSAGE };
    }
    return { kind: 'error', message: error.userMessage };
  }
  return { kind: 'unavailable' };
}

/* ------------------------------------------------------------------ *
 * Diagnose — the dial-in surface (§7.1, brew_logger_ux §6)
 * ------------------------------------------------------------------ */

export interface AiDiagnosis {
  /** The ONE suggestion (§7.2.2). Plain warm language, safe-markdown rendered. */
  advice: string;
  /** The single variable being moved, e.g. "grind". */
  variable: string | null;
  /** Which way, e.g. "finer". */
  direction: string | null;
  confidence: AiConfidence | null;
  basis: AiBasis | null;
  entities: AiEntity[];
}

export function normalizeDiagnosis(raw: unknown): AiDiagnosis | null {
  const record = asRecord(raw);
  if (!record) return null;

  const advice = pickText(record, ['advice', 'suggestion', 'text', 'message']);
  // No advice means no surface. Rendering a bare "we looked!" card is noise.
  if (!advice) return null;

  return {
    advice,
    variable: pickText(record, ['variable', 'field']),
    direction: pickText(record, ['direction', 'change']),
    confidence: normalizeConfidence(record['confidence']),
    basis: normalizeBasis(record['basis']),
    entities: normalizeEntities(record['entities']),
  };
}

/* ------------------------------------------------------------------ *
 * Starting recipe (§7.1)
 * ------------------------------------------------------------------ */

export interface AiRecipeStep {
  label: string;
  value: string;
}

export interface AiStartingRecipe {
  /** Prose the model wrote about the recipe, if any. */
  summary: string | null;
  /** The numbers, named. Only keys we recognise — never a JSON dump. */
  steps: AiRecipeStep[];
  notes: string | null;
  basis: AiBasis | null;
  entities: AiEntity[];
}

function formatSeconds(total: number): string {
  const rounded = Math.round(total);
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Ordered so the card always reads brewer → coffee → water → grind → temp → time. */
const RECIPE_FIELDS: Array<{
  label: string;
  keys: string[];
  format: (value: unknown) => string | null;
}> = [
  { label: 'Method', keys: ['method'], format: (v) => asText(v) },
  {
    label: 'Brewer',
    keys: ['brewer', 'brewer_label', 'brewer_name'],
    format: (v) => asText(v),
  },
  {
    label: 'Coffee',
    keys: ['dose_g', 'dose'],
    format: (v) => (asNumber(v) === null ? null : `${asNumber(v)} g`),
  },
  {
    label: 'Water',
    keys: ['water_g', 'water'],
    format: (v) => (asNumber(v) === null ? null : `${asNumber(v)} g`),
  },
  {
    label: 'Ratio',
    keys: ['ratio'],
    format: (v) => {
      const text = asText(v);
      if (text && text.includes(':')) return text;
      const value = asNumber(v);
      return value === null ? null : `1:${Math.round(value * 10) / 10}`;
    },
  },
  {
    label: 'Grind',
    keys: ['grind_setting', 'grind', 'grind_category'],
    format: (v) => asText(v) ?? (asNumber(v) === null ? null : String(asNumber(v))),
  },
  {
    label: 'Water temperature',
    keys: ['temperature_c', 'temp_c', 'temperature'],
    format: (v) => (asNumber(v) === null ? null : `${asNumber(v)} °C`),
  },
  {
    label: 'Bloom',
    keys: ['bloom_g', 'bloom_water_g'],
    format: (v) => (asNumber(v) === null ? null : `${asNumber(v)} g`),
  },
  {
    label: 'Total time',
    keys: ['brew_time_s', 'total_time_s', 'time_s'],
    format: (v) => (asNumber(v) === null ? null : formatSeconds(asNumber(v) as number)),
  },
];

export function normalizeStartingRecipe(raw: unknown): AiStartingRecipe | null {
  const envelope = asRecord(raw);
  if (!envelope) return null;

  const basis = normalizeBasis(envelope['basis']);
  const entities = normalizeEntities(envelope['entities']);
  const rawRecipe = envelope['recipe'];

  // The whole recipe may arrive as prose. That is a legitimate answer.
  const prose = asText(rawRecipe);
  if (prose) return { summary: prose, steps: [], notes: null, basis, entities };

  const recipe = asRecord(rawRecipe) ?? envelope;
  const steps: AiRecipeStep[] = [];
  for (const field of RECIPE_FIELDS) {
    for (const key of field.keys) {
      if (!(key in recipe)) continue;
      const formatted = field.format(recipe[key]);
      if (formatted !== null) {
        steps.push({ label: field.label, value: formatted });
        break;
      }
    }
  }

  const summary = pickText(recipe, ['summary', 'description', 'text']);
  const notes = pickText(recipe, ['notes', 'note', 'tips', 'advice']);

  if (steps.length === 0 && !summary && !notes) return null;
  return { summary, steps, notes, basis, entities };
}

/* ------------------------------------------------------------------ *
 * JSON endpoints
 * ------------------------------------------------------------------ */

export const aiApi = {
  /** Dial-in advice for a brew the user just logged and tasted. */
  diagnose: (input: { brew_session_id: string }, options?: ApiRequestOptions) =>
    apiFetch<unknown>(AI_PATHS.diagnose, { ...options, method: 'POST', body: input }),

  startingRecipe: (
    input: {
      coffee_product_id: string;
      brewer_model_id?: string;
      grinder_model_id?: string;
    },
    options?: ApiRequestOptions,
  ) => apiFetch<unknown>(AI_PATHS.startingRecipe, { ...options, method: 'POST', body: input }),
} as const;

/** Resolves to the diagnosis, or a reason it is not there. Never rejects. */
export async function fetchDiagnosis(
  brewSessionId: string,
  options?: ApiRequestOptions,
): Promise<{ ok: true; diagnosis: AiDiagnosis } | { ok: false; failure: AiFailure }> {
  try {
    const diagnosis = normalizeDiagnosis(
      await aiApi.diagnose({ brew_session_id: brewSessionId }, options),
    );
    return diagnosis
      ? { ok: true, diagnosis }
      : { ok: false, failure: { kind: 'unavailable' } };
  } catch (error) {
    return { ok: false, failure: classifyAiError(error) };
  }
}

/** Same contract as {@link fetchDiagnosis}: resolves, never rejects. */
export async function fetchStartingRecipe(
  input: { coffee_product_id: string; brewer_model_id?: string; grinder_model_id?: string },
  options?: ApiRequestOptions,
): Promise<{ ok: true; recipe: AiStartingRecipe } | { ok: false; failure: AiFailure }> {
  try {
    const recipe = normalizeStartingRecipe(await aiApi.startingRecipe(input, options));
    return recipe ? { ok: true, recipe } : { ok: false, failure: { kind: 'unavailable' } };
  } catch (error) {
    return { ok: false, failure: classifyAiError(error) };
  }
}

/* ------------------------------------------------------------------ *
 * Chat stream (SSE)
 * ------------------------------------------------------------------ */

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type AiStreamEvent =
  /** A slice of the answer. Chunk boundaries are meaningless — append in order. */
  | { type: 'text'; text: string }
  /** Tool activity, already turned into a quiet human sentence. */
  | { type: 'tool'; label: string }
  /** The allowlisted references for the answer so far. */
  | { type: 'entities'; entities: AiEntity[] }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface SseFrame {
  event: string | null;
  data: string;
}

/**
 * Incremental SSE frame parser.
 *
 * A network chunk is not a frame: one `read()` can deliver half an event, three
 * events, or a single `\n`. Everything up to the last blank-line boundary is
 * emitted; the remainder stays buffered for the next chunk.
 */
export function createSseParser(): {
  push(chunk: string): SseFrame[];
  flush(): SseFrame[];
} {
  let buffer = '';

  const parseBlock = (block: string): SseFrame | null => {
    let event: string | null = null;
    const dataLines: string[] = [];
    for (const rawLine of block.split(/\r?\n/)) {
      const line = rawLine.replace(/\r$/, '');
      if (line === '' || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      // Per the spec a single leading space after the colon is not data.
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') dataLines.push(value);
    }
    if (dataLines.length === 0 && event === null) return null;
    return { event, data: dataLines.join('\n') };
  };

  return {
    push(chunk: string): SseFrame[] {
      buffer += chunk;
      const frames: SseFrame[] = [];
      // Split on the blank line that terminates an event.
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const frame = parseBlock(part);
        if (frame) frames.push(frame);
      }
      return frames;
    },
    flush(): SseFrame[] {
      const remaining = buffer;
      buffer = '';
      if (remaining.trim() === '') return [];
      const frame = parseBlock(remaining);
      return frame ? [frame] : [];
    },
  };
}

/**
 * Tool name → a sentence a person would say. Unknown tools still get a quiet
 * line; what they never get is their raw name or their JSON arguments on screen.
 */
const TOOL_LABELS: Record<string, string> = {
  get_brew_history: 'reading your recent brews…',
  get_brew_sessions: 'reading your recent brews…',
  get_user_equipment: 'looking at your equipment…',
  get_equipment: 'looking at your equipment…',
  search_equipment: 'looking at your equipment…',
  get_coffee: 'looking up that coffee…',
  search_coffees: 'searching the coffee catalogue…',
  get_recipes: 'checking community recipes…',
  search_recipes: 'checking community recipes…',
  get_roaster: 'looking up the roaster…',
  get_taste_profile: 'checking your taste profile…',
  search_articles: 'reading the coffee news…',
};

export function toolStatusLabel(name: string | null): string {
  if (!name) return 'looking that up…';
  return TOOL_LABELS[name] ?? 'looking that up…';
}

const TEXT_KEYS = ['text', 'delta', 'content', 'token', 'value', 'chunk'];

/**
 * One SSE frame → zero or more UI events.
 *
 * Deliberately generous about shape (Lane O may land `{type:'token',text}` or
 * `{delta}` or bare text) and deliberately strict about *unknown* shapes: if we
 * cannot name it, it produces nothing rather than leaking JSON into the answer.
 */
export function parseAiFrame(frame: SseFrame): AiStreamEvent[] {
  const data = frame.data.trim();
  if (data === '' ) return [];
  if (data === '[DONE]') return [{ type: 'done' }];

  const eventName = frame.event?.toLowerCase() ?? null;

  let payload: unknown;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    // Not JSON. A server streaming bare text is a legitimate, simpler contract.
    if (eventName === null || eventName === 'message' || eventName === 'token' || eventName === 'text' || eventName === 'delta') {
      return [{ type: 'text', text: frame.data }];
    }
    return [];
  }

  if (typeof payload === 'string') return [{ type: 'text', text: payload }];

  const record = asRecord(payload);
  if (!record) return [];

  const type = (pickText(record, ['type', 'event']) ?? eventName ?? '').toLowerCase();
  const events: AiStreamEvent[] = [];

  const readText = (): string | null => {
    for (const key of TEXT_KEYS) {
      const value = record[key];
      if (typeof value === 'string' && value !== '') return value;
      const nested = asRecord(value);
      if (nested) {
        for (const inner of TEXT_KEYS) {
          const innerValue = nested[inner];
          if (typeof innerValue === 'string' && innerValue !== '') return innerValue;
        }
      }
    }
    return null;
  };

  switch (type) {
    case 'token':
    case 'text':
    case 'delta':
    case 'content':
    case 'message':
    case 'content_block_delta': {
      const text = readText();
      if (text !== null) events.push({ type: 'text', text });
      break;
    }
    case 'tool':
    case 'tool_use':
    case 'tool_call':
    case 'status': {
      events.push({ type: 'tool', label: toolStatusLabel(pickText(record, ['name', 'tool', 'tool_name'])) });
      break;
    }
    case 'entities':
    case 'entity':
    case 'references': {
      const entities = normalizeEntities(record['entities'] ?? record['references'] ?? payload);
      if (entities.length > 0) events.push({ type: 'entities', entities });
      break;
    }
    case 'error': {
      const message = pickText(record, ['message', 'error', 'detail']);
      events.push({
        type: 'error',
        message: message ?? 'That answer stopped early. Try asking again.',
      });
      break;
    }
    case 'done':
    case 'end':
    case 'complete':
    case 'message_stop': {
      const entities = normalizeEntities(record['entities']);
      if (entities.length > 0) events.push({ type: 'entities', entities });
      events.push({ type: 'done' });
      break;
    }
    default: {
      // No `type`, but a recognisable payload: take it.
      const text = readText();
      if (text !== null) {
        events.push({ type: 'text', text });
        break;
      }
      const entities = normalizeEntities(record['entities']);
      if (entities.length > 0) events.push({ type: 'entities', entities });
      break;
    }
  }

  return events;
}

export interface StreamAiChatOptions {
  messages: AiChatMessage[];
  onEvent: (event: AiStreamEvent) => void;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}

/**
 * CSRF for the stream. `apiFetch` owns a private cached token and cannot be used
 * for an SSE response, so this mirrors its behaviour (mint lazily, retry once)
 * using `apiFetch` itself for the token fetch — the endpoint stays in one place.
 */
let streamCsrfToken: string | null = null;

/** Test seam — drops the cached stream CSRF token. */
export function resetAiStreamState(): void {
  streamCsrfToken = null;
}

async function mintCsrfToken(fetchImpl?: FetchLike, baseUrl?: string): Promise<string | null> {
  try {
    const body = await apiFetch<unknown>('/api/v1/auth/csrf', {
      refreshOn401: false,
      ...(fetchImpl ? { fetchImpl } : {}),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
    });
    const record = asRecord(body);
    if (!record) return null;
    return pickText(record, ['csrf_token', 'token']);
  } catch {
    return null;
  }
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === 'AbortError'
      : Boolean(error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError')
  );
}

async function readErrorEnvelope(res: Response): Promise<ApiError> {
  try {
    const parsed: unknown = await res.json();
    const record = asRecord(parsed);
    return new ApiError(res.status, {
      error: (record && asText(record['error'])) || 'unknown_error',
      message: (record && asText(record['message'])) || '',
    });
  } catch {
    return new ApiError(res.status, { error: 'unknown_error', message: '' });
  }
}

/** The API's `history` cap (chatBody in the intelligence module's schemas.ts). */
const HISTORY_LIMIT = 20;

/**
 * UI conversation -> the API's request body.
 *
 * These two shapes are NOT the same and the difference is load-bearing. The UI
 * keeps one flat `AiChatMessage[]` because that is what it renders. The API
 * takes the new turn as `message` and the preceding turns as `history`, with
 * `text` rather than `content`, because only the new turn is subject to the
 * 4,000-character input cap.
 *
 * Posting the UI's array verbatim -- which is what this did -- fails Zod with
 * "expected string, received undefined" and returns 400 before a single token
 * is generated. On screen that is indistinguishable from the model having
 * nothing to say: you type, you press send, and nothing ever comes back.
 * Nothing caught it because the web tests stub `fetch`, so both sides were
 * internally consistent and disagreed only in production.
 */
export function toChatBody(messages: AiChatMessage[]): { message: string; history?: { role: 'user' | 'assistant'; text: string }[] } {
  // The last USER turn is the question; anything after it would be an
  // optimistic placeholder for the answer we are about to stream.
  let index = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') { index = i; break; }
  }
  const current = index >= 0 ? messages[index] : undefined;
  const history = (index >= 0 ? messages.slice(0, index) : messages)
    .filter((m) => m.content.trim() !== '')
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role, text: m.content }));

  return {
    message: current?.content ?? '',
    ...(history.length > 0 ? { history } : {}),
  };
}

/**
 * POST the conversation and stream the answer back.
 *
 * Resolves when the stream ends (normally, or because it was aborted). Throws
 * {@link ApiError} only for a request that never became a stream — a connection
 * that dies *mid*-answer is surfaced as an `error` event so the partial answer
 * on screen survives.
 */
export async function streamAiChat({
  messages,
  onEvent,
  signal,
  fetchImpl,
  baseUrl,
}: StreamAiChatOptions): Promise<void> {
  const doFetch: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));
  const url = resolveApiUrl(AI_PATHS.chat, baseUrl);
  const payload = JSON.stringify(toChatBody(messages));

  const send = async (csrf: string | null): Promise<Response> => {
    const headers = new Headers({
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    });
    if (csrf) headers.set('x-csrf-token', csrf);
    return doFetch(url, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: payload,
      ...(signal ? { signal } : {}),
    });
  };

  let res: Response;
  try {
    res = await send(streamCsrfToken);
  } catch (error) {
    if (isAbort(error) || signal?.aborted) return;
    throw new ApiError(0, { error: 'network_error', message: '' });
  }

  if (res.status === 403) {
    const fresh = await mintCsrfToken(fetchImpl, baseUrl);
    if (fresh) {
      streamCsrfToken = fresh;
      try {
        res = await send(fresh);
      } catch (error) {
        if (isAbort(error) || signal?.aborted) return;
        throw new ApiError(0, { error: 'network_error', message: '' });
      }
    }
  }

  if (res.status === 401) {
    const refreshed = await apiFetch<unknown>('/api/v1/auth/refresh', {
      method: 'POST',
      refreshOn401: false,
      ...(fetchImpl ? { fetchImpl } : {}),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
    })
      .then(() => true)
      .catch(() => false);
    if (refreshed) {
      try {
        res = await send(streamCsrfToken);
      } catch (error) {
        if (isAbort(error) || signal?.aborted) return;
        throw new ApiError(0, { error: 'network_error', message: '' });
      }
    }
  }

  if (!res.ok) throw await readErrorEnvelope(res);

  let finished = false;
  const emit = (event: AiStreamEvent): void => {
    if (finished || signal?.aborted) return;
    if (event.type === 'done') finished = true;
    onEvent(event);
  };

  const parser = createSseParser();
  const body = res.body as ReadableStream<Uint8Array | string> | null | undefined;

  // A server (or a proxy) that answered without a readable body still answered:
  // parse whatever text came back in one go rather than showing nothing.
  if (!body || typeof body.getReader !== 'function') {
    const text = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
    for (const frame of [...parser.push(text), ...parser.flush()]) {
      for (const event of parseAiFrame(frame)) emit(event);
    }
    emit({ type: 'done' });
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();

  // Abort must end the read even when the transport ignores the signal (which
  // is exactly what a mocked fetch does).
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) return;
      const chunk = typeof value === 'string' ? value : decoder.decode(value, { stream: true });
      for (const frame of parser.push(chunk)) {
        for (const event of parseAiFrame(frame)) emit(event);
      }
      if (finished) break;
    }
    if (!finished && !signal?.aborted) {
      for (const frame of parser.flush()) {
        for (const event of parseAiFrame(frame)) emit(event);
      }
    }
  } catch (error) {
    if (isAbort(error) || signal?.aborted) return;
    // The answer on screen is real and stays. We just say the rest is missing.
    emit({
      type: 'error',
      message: 'The connection dropped part-way through that answer. Ask again when you like.',
    });
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  if (!signal?.aborted) emit({ type: 'done' });
}
