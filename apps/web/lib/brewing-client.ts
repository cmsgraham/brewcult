/**
 * Brewing client — the API seam and the pure domain logic behind the logger
 * (docs/brew_logger_ux.md, packages/shared-types/src/brewing.ts).
 *
 * Everything here is either (a) a thin typed call through `lib/api.ts` — the one
 * fetch wrapper, never forked — or (b) a pure function, so the arithmetic that
 * decides what gets logged is unit-testable without a DOM or a server.
 *
 * Scope note (§8 decision 1): **filter only**. The persisted shape is the
 * discriminated `FilterParams | EspressoParams`, so the espresso card is
 * additive UI later with no migration.
 */
import type {
  BrewPrefill,
  BrewSession,
  BrewSource,
  FilterParams,
  GrindCategory,
  GrindSetting,
  ParamsSchemaVersion,
  SyncChangesResponse,
  SyncUpsertResult,
  TasteVerdict,
} from '@brewcult/shared-types';
import { apiFetch, catalogApi, type ApiRequestOptions, type AutocompleteSuggestion } from './api';
import { en } from '../messages/en';
import {
  DEFAULT_LOCALE,
  translate,
  type Locale,
  type MessageKey,
  type Messages,
  type Translator,
} from './i18n';

/** This client writes v1 params (see shared-types header on versioning). */
export const PARAMS_SCHEMA_VERSION: ParamsSchemaVersion = 1;

/**
 * English unless told otherwise.
 *
 * The pure functions below (payback lines, taste labels) predate translation
 * and are called from tests and from server code that has no translator to
 * hand. Rather than force a locale through every call site, they take an
 * optional `t` and fall back to this — so an untranslated caller keeps exactly
 * the wording it had.
 */
const EN: Translator = (key, values) => translate(en as Messages, key, values);

/* ------------------------------------------------------------------ *
 * Wire shapes
 * ------------------------------------------------------------------ */

/** A coffee as the logger needs to show it: id may be null for a quick-add. */
export interface CoffeeRef {
  id: string | null;
  label: string;
  subtitle?: string | null;
}

/** Path C's three-field fallback, so an uncatalogued bag never blocks a log. */
export interface ProvisionalCoffee {
  roaster: string;
  name: string;
  roast_level: string;
}

/**
 * What we PUT. `provisional_coffee` is additive — the server may ignore it
 * today (Lane H) and promote it to a real catalog entity later; either way the
 * brew is logged and the label survives locally.
 */
export interface BrewUpsertBody extends BrewSession {
  provisional_coffee?: ProvisionalCoffee;
}

/** A session as the device holds it, with the labels the API does not return. */
export interface LocalBrewRecord {
  session: BrewUpsertBody;
  coffee_label: string | null;
  brewer_label: string | null;
  /** False until the queue has confirmed the upsert. */
  synced: boolean;
}

export const BREW_PATHS = {
  prefill: '/api/v1/brews/prefill',
  brews: '/api/v1/brews',
  changes: '/api/v1/sync/changes',
} as const;

export const brewingApi = {
  /** Path A/B's starting point. Cache-first callers should treat this as a refresh. */
  prefill: (coffeeProductId: string | null, options?: ApiRequestOptions) => {
    const query = coffeeProductId
      ? `?${new URLSearchParams({ coffee_product_id: coffeeProductId }).toString()}`
      : '';
    return apiFetch<BrewPrefill>(`${BREW_PATHS.prefill}${query}`, options);
  },

  /** Idempotent by construction — the id is ours (EF §2.2). */
  upsert: (session: BrewUpsertBody, options?: ApiRequestOptions) =>
    apiFetch<SyncUpsertResult>(`${BREW_PATHS.brews}/${encodeURIComponent(session.id)}`, {
      ...options,
      method: 'PUT',
      body: session,
    }),

  list: (
    params: { coffee_product_id?: string | null; cursor?: string | null; limit?: number } = {},
    options?: ApiRequestOptions,
  ) => {
    const search = new URLSearchParams();
    if (params.coffee_product_id) search.set('coffee_product_id', params.coffee_product_id);
    if (params.cursor) search.set('cursor', params.cursor);
    if (params.limit) search.set('limit', String(params.limit));
    const query = search.toString();
    return apiFetch<unknown>(`${BREW_PATHS.brews}${query ? `?${query}` : ''}`, options);
  },

  /**
   * Soft-deletes a brew. 204, and the server emits a tombstone so the deletion
   * reaches every other device through `/sync/changes` rather than lingering
   * on the phone that did not perform it.
   */
  remove: (id: string, options?: ApiRequestOptions) =>
    apiFetch<void>(`${BREW_PATHS.brews}/${encodeURIComponent(id)}`, {
      ...options,
      method: 'DELETE',
    }),

  changes: (since: string | null, types: string[] = ['brew_session'], options?: ApiRequestOptions) => {
    const search = new URLSearchParams();
    if (since) search.set('since', since);
    if (types.length > 0) search.set('types', types.join(','));
    return apiFetch<SyncChangesResponse>(`${BREW_PATHS.changes}?${search.toString()}`, options);
  },

  /** Path C search, straight over the existing catalog autocomplete (CAT-06). */
  searchCoffees: (query: string, options?: ApiRequestOptions) =>
    catalogApi.autocomplete(query, ['coffee'], options),
} as const;

/**
 * A session as the LIST returns it: the row, plus what its ids point at.
 *
 * `GET /v1/brews` joins the coffee and the brewer so a history does not have to
 * render UUIDs. Every label is nullable and that is ordinary — a quick-add bag
 * has no catalogue row, which is the usual state of somebody's first brews.
 */
export interface LabelledBrewSession extends BrewSession {
  coffee_label: string | null;
  coffee_slug: string | null;
  roaster_label: string | null;
  brewer_label: string | null;
}

/** The list endpoint is keyset-paginated; tolerate either envelope shape. */
export function normalizeBrewList(raw: unknown): {
  items: LabelledBrewSession[];
  nextCursor: string | null;
} {
  if (Array.isArray(raw)) return { items: raw as LabelledBrewSession[], nextCursor: null };
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    const items = Array.isArray(record['items'])
      ? (record['items'] as LabelledBrewSession[])
      : Array.isArray(record['brews'])
        ? (record['brews'] as LabelledBrewSession[])
        : [];
    // The API envelope is { items, next_cursor } (matching catalog); the other
    // spellings are tolerated so a shape change can't silently stop pagination.
    const cursor = record['next_cursor'] ?? record['nextCursor'] ?? record['cursor'] ?? null;
    return { items, nextCursor: typeof cursor === 'string' ? cursor : null };
  }
  return { items: [], nextCursor: null };
}

export function toCoffeeRef(suggestion: AutocompleteSuggestion): CoffeeRef {
  // `sublabel` on the wire, `subtitle` in our own CoffeeRef. Reading the wrong
  // one here is why every suggestion lost its roaster name.
  return { id: suggestion.id, label: suggestion.label, subtitle: suggestion.sublabel ?? null };
}

/* ------------------------------------------------------------------ *
 * Steps, limits and the numbers themselves
 * ------------------------------------------------------------------ */

/** §3 Path B: "sane increments" — the reason the keyboard never appears. */
export const STEP = {
  grind: 0.5,
  dose_g: 0.5,
  water_g: 5,
  temperature_c: 1,
  brew_time_s: 5,
} as const;

/** Guard rails, not opinions: they only stop typos, never a real recipe. */
export const LIMIT = {
  grind: { min: 0, max: 60 },
  dose_g: { min: 1, max: 200 },
  water_g: { min: 10, max: 3000 },
  temperature_c: { min: 50, max: 100 },
  brew_time_s: { min: 0, max: 3600 },
} as const;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Brew ratio as a plain number (water ÷ dose). */
export function ratioOf(dose_g: number, water_g: number): number {
  if (!Number.isFinite(dose_g) || dose_g <= 0) return 0;
  return water_g / dose_g;
}

/** "1:16.7" — how every filter brewer on earth says it. */
export function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return '—';
  return `1:${roundTo(ratio, 1).toFixed(1)}`;
}

/** Water that follows a dose change at the locked ratio. */
export function deriveWater(dose_g: number, ratio: number): number {
  return clamp(Math.round(dose_g * ratio), LIMIT.water_g.min, LIMIT.water_g.max);
}

/** Dose that follows a water change at the locked ratio. */
export function deriveDose(water_g: number, ratio: number): number {
  if (ratio <= 0) return 0;
  return clamp(roundTo(water_g / ratio, 1), LIMIT.dose_g.min, LIMIT.dose_g.max);
}

/** 165 → "2:45". Absent time reads as an em dash, never "0:00". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** "2:45" or "165" → 165. Returns null for anything we cannot read. */
export function parseDuration(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const parts = trimmed.split(':');
  if (parts.length === 2) {
    const minutes = Number.parseInt(parts[0] ?? '', 10);
    const seconds = Number.parseInt(parts[1] ?? '', 10);
    if (Number.isNaN(minutes) || Number.isNaN(seconds)) return null;
    return minutes * 60 + seconds;
  }
  const asNumber = Number.parseFloat(trimmed);
  return Number.isNaN(asNumber) ? null : Math.round(asNumber);
}

/* ------------------------------------------------------------------ *
 * The draft — what Path B edits and what survives a reload
 * ------------------------------------------------------------------ */

export type BrewField =
  | 'grind'
  | 'dose_g'
  | 'water_g'
  | 'temperature_c'
  | 'brew_time_s'
  | 'coffee_product_id'
  | 'brewer_model_id';

/** Which of dose/water follows the other when the locked ratio is applied. */
export type RatioFollow = 'water' | 'dose';

export interface BrewDraft {
  coffee: CoffeeRef | null;
  provisional_coffee: ProvisionalCoffee | null;
  brewer_model_id: string | null;
  brewer_label: string | null;
  grinder_model_id: string | null;
  /** Contract shape: text, because grinder scales are not uniformly numeric. */
  grind_setting: string;
  grind_category: GrindCategory;
  dose_g: number;
  water_g: number;
  temperature_c: number;
  brew_time_s: number | null;
  /** The locked ratio the follower is derived at. */
  ratio: number;
  follow: RatioFollow;
  verdict: TasteVerdict | null;
  /** Epoch ms; non-null means the timer is running. Survives backgrounding. */
  timer_started_at: number | null;
  /** Exactly what the user touched — never the value that followed (§3). */
  changed: BrewField[];
  recipe_id: string | null;
  updated_at: string;
}

export const DEFAULT_GRIND: GrindSetting = {
  equipment_model_id: null,
  setting: '6.5',
  scale_type: 'stepless',
  category: 'medium',
};

export const DEFAULT_FILTER_PARAMS: FilterParams = {
  method: 'filter',
  dose_g: 15,
  water_g: 250,
  ratio: 250 / 15,
  temperature_c: 94,
};

/**
 * The prefill we open with when nothing is known yet. `basis: 'defaults'` so the
 * UI can be honest about it ("a starting point, not your recipe").
 */
export function defaultPrefill(): BrewPrefill {
  return {
    coffee_product_id: null,
    recipe_id: null,
    brewer_model_id: null,
    grinder_model_id: null,
    grind: { ...DEFAULT_GRIND },
    params: { ...DEFAULT_FILTER_PARAMS },
    basis: 'defaults',
  };
}

export function isFilterParams(params: BrewPrefill['params']): params is FilterParams {
  return params.method === 'filter' || params.method === 'immersion';
}

/** Numeric view of a grind setting, or null for "2 rotations + 6 clicks" style. */
export function grindNumber(setting: string | null | undefined): number | null {
  if (!setting) return null;
  const parsed = Number.parseFloat(setting);
  return Number.isFinite(parsed) && /^\s*-?\d/.test(setting) ? parsed : null;
}

export function draftFromPrefill(
  prefill: BrewPrefill,
  options: { coffee?: CoffeeRef | null; brewerLabel?: string | null; now?: number } = {},
): BrewDraft {
  const params = isFilterParams(prefill.params) ? prefill.params : DEFAULT_FILTER_PARAMS;
  const dose = params.dose_g || DEFAULT_FILTER_PARAMS.dose_g;
  const water = params.water_g || DEFAULT_FILTER_PARAMS.water_g;

  return {
    coffee:
      options.coffee ??
      (prefill.coffee_product_id
        ? { id: prefill.coffee_product_id, label: 'Your coffee' }
        : null),
    provisional_coffee: null,
    brewer_model_id: prefill.brewer_model_id,
    brewer_label: options.brewerLabel ?? null,
    grinder_model_id: prefill.grinder_model_id,
    grind_setting: prefill.grind.setting ?? DEFAULT_GRIND.setting ?? '',
    grind_category: prefill.grind.category,
    dose_g: dose,
    water_g: water,
    temperature_c: params.temperature_c ?? DEFAULT_FILTER_PARAMS.temperature_c ?? 94,
    brew_time_s: params.brew_time_s ?? null,
    ratio: params.ratio && params.ratio > 0 ? params.ratio : ratioOf(dose, water),
    follow: 'water',
    verdict: null,
    timer_started_at: null,
    changed: [],
    recipe_id: prefill.recipe_id,
    updated_at: new Date(options.now ?? Date.now()).toISOString(),
  };
}

function markChanged(changed: BrewField[], field: BrewField): BrewField[] {
  return changed.includes(field) ? changed : [...changed, field];
}

/**
 * Set one numeric field.
 *
 * The follower (water when `follow === 'water'`, dose otherwise) is recomputed
 * at the locked ratio and **is not recorded as a change** — the user moved one
 * variable, and that is the signal §3 wants to keep clean. Editing the follower
 * directly is how you change the ratio, and that *is* recorded.
 */
export function setNumericField(
  draft: BrewDraft,
  field: 'grind' | 'dose_g' | 'water_g' | 'temperature_c' | 'brew_time_s',
  rawValue: number,
  now: number = Date.now(),
): BrewDraft {
  const stamped = { ...draft, updated_at: new Date(now).toISOString() };

  switch (field) {
    case 'grind': {
      const value = clamp(roundTo(rawValue, 2), LIMIT.grind.min, LIMIT.grind.max);
      return {
        ...stamped,
        grind_setting: String(roundTo(value, 2)),
        changed: markChanged(draft.changed, 'grind'),
      };
    }
    case 'dose_g': {
      const dose = clamp(roundTo(rawValue, 1), LIMIT.dose_g.min, LIMIT.dose_g.max);
      const water = draft.follow === 'water' ? deriveWater(dose, draft.ratio) : draft.water_g;
      return {
        ...stamped,
        dose_g: dose,
        water_g: water,
        ratio: draft.follow === 'water' ? draft.ratio : ratioOf(dose, water),
        changed: markChanged(draft.changed, 'dose_g'),
      };
    }
    case 'water_g': {
      const water = clamp(Math.round(rawValue), LIMIT.water_g.min, LIMIT.water_g.max);
      const dose = draft.follow === 'dose' ? deriveDose(water, draft.ratio) : draft.dose_g;
      return {
        ...stamped,
        water_g: water,
        dose_g: dose,
        ratio: draft.follow === 'dose' ? draft.ratio : ratioOf(dose, water),
        changed: markChanged(draft.changed, 'water_g'),
      };
    }
    case 'temperature_c': {
      return {
        ...stamped,
        temperature_c: clamp(
          Math.round(rawValue),
          LIMIT.temperature_c.min,
          LIMIT.temperature_c.max,
        ),
        changed: markChanged(draft.changed, 'temperature_c'),
      };
    }
    case 'brew_time_s': {
      return {
        ...stamped,
        brew_time_s: clamp(Math.round(rawValue), LIMIT.brew_time_s.min, LIMIT.brew_time_s.max),
        changed: markChanged(draft.changed, 'brew_time_s'),
      };
    }
  }
}

/**
 * Set the grind as text — the escape hatch for scales the stepper cannot model
 * ("2.6" meaning 2 rotations + 6 clicks). Still one changed field.
 */
export function setGrindSetting(draft: BrewDraft, setting: string): BrewDraft {
  return { ...draft, grind_setting: setting, changed: markChanged(draft.changed, 'grind') };
}

/** Grind category is the value that survives a change of grinder (§6.4). */
export function setGrindCategory(draft: BrewDraft, category: GrindCategory): BrewDraft {
  return { ...draft, grind_category: category, changed: markChanged(draft.changed, 'grind') };
}

/** Flip which of dose/water follows the locked ratio. Not a value change. */
export function toggleRatioLock(draft: BrewDraft): BrewDraft {
  return { ...draft, follow: draft.follow === 'water' ? 'dose' : 'water' };
}

export function setCoffee(
  draft: BrewDraft,
  coffee: CoffeeRef | null,
  provisional: ProvisionalCoffee | null = null,
): BrewDraft {
  const same = coffee?.id !== null && coffee?.id === draft.coffee?.id;
  return {
    ...draft,
    coffee,
    provisional_coffee: provisional,
    changed: same ? draft.changed : markChanged(draft.changed, 'coffee_product_id'),
  };
}

/** Taste is a *result*, not a parameter: it never lands in `changed_fields`. */
export function setVerdict(draft: BrewDraft, verdict: TasteVerdict | null): BrewDraft {
  return { ...draft, verdict };
}

/* ------------------------------------------------------------------ *
 * Draft -> session
 * ------------------------------------------------------------------ */

export function sessionFromDraft(
  draft: BrewDraft,
  options: {
    id: string;
    source: BrewSource;
    userId?: string;
    now?: number;
    brewedAt?: string;
  },
): BrewUpsertBody {
  const now = options.now ?? Date.now();
  const timestamp = new Date(now).toISOString();
  const params: FilterParams = {
    method: 'filter',
    dose_g: draft.dose_g,
    water_g: draft.water_g,
    ratio: roundTo(ratioOf(draft.dose_g, draft.water_g), 2),
    temperature_c: draft.temperature_c,
    ...(draft.brew_time_s !== null ? { brew_time_s: draft.brew_time_s } : {}),
  };

  return {
    id: options.id,
    // Server-owned; the API resolves the actor from the session cookie and
    // overwrites this. Sent as '' rather than omitted so the local record and
    // the wire body are one shape.
    user_id: options.userId ?? '',
    recipe_id: draft.recipe_id,
    coffee_product_id: draft.coffee?.id ?? null,
    roast_batch_id: null,
    brewer_model_id: draft.brewer_model_id,
    grinder_model_id: draft.grinder_model_id,
    grind: {
      equipment_model_id: draft.grinder_model_id,
      setting: draft.grind_setting,
      scale_type: 'stepless',
      category: draft.grind_category,
    },
    params,
    params_schema_version: PARAMS_SCHEMA_VERSION,
    ...(draft.verdict ? { taste: { verdict: draft.verdict } } : {}),
    changed_fields: [...draft.changed],
    source: options.source,
    brewed_at: options.brewedAt ?? timestamp,
    created_at: timestamp,
    updated_at: timestamp,
    ...(draft.provisional_coffee ? { provisional_coffee: draft.provisional_coffee } : {}),
  };
}

/** Path A/B/C in one place, so the analytics and the copy cannot disagree. */
export function sourceForDraft(draft: BrewDraft): BrewSource {
  if (draft.changed.includes('coffee_product_id') || draft.provisional_coffee) return 'new';
  return draft.changed.length > 0 ? 'tweak' : 'repeat';
}

/** One-line recap: "15g → 250g · 94° · 2:45 · grind 6.5". */
export function summarizeDraft(draft: BrewDraft): string {
  const bits = [
    `${roundTo(draft.dose_g, 1)}g → ${Math.round(draft.water_g)}g`,
    `${Math.round(draft.temperature_c)}°`,
  ];
  if (draft.brew_time_s !== null) bits.push(formatDuration(draft.brew_time_s));
  if (draft.grind_setting) bits.push(`grind ${draft.grind_setting}`);
  return bits.join(' · ');
}

/* ------------------------------------------------------------------ *
 * Taste (§6.7) and the post-log payback line (§6)
 * ------------------------------------------------------------------ */

/**
 * The four taste verdicts.
 *
 * These carried emoji faces until it became clear they were doing no work: the
 * label already says "Bitter", and a grimacing face renders as four different
 * house styles across platforms — only adding noise to a control that has to be
 * tapped in under fifteen seconds. The selected state carries the weight now.
 */
export interface TasteOption {
  verdict: TasteVerdict;
  label: string;
  /** Client-side hint only — the authoritative mapping is server-side. */
  hint: string;
}

const TASTE_KEYS: ReadonlyArray<{
  verdict: TasteVerdict;
  label: MessageKey;
  hint: MessageKey;
}> = [
  { verdict: 'bitter', label: 'brew.tasteBitter', hint: 'brew.hintOverExtracted' },
  { verdict: 'sour', label: 'brew.tasteSour', hint: 'brew.hintUnderExtracted' },
  { verdict: 'weak', label: 'brew.tasteWeak', hint: 'brew.hintUnderExtracted' },
  { verdict: 'good', label: 'brew.tasteGood', hint: 'brew.hintKeeper' },
];

/** The four taste buttons, in the reader's language. */
export function tasteOptions(t: Translator = EN): ReadonlyArray<TasteOption> {
  return TASTE_KEYS.map((option) => ({
    verdict: option.verdict,
    label: t(option.label),
    hint: t(option.hint),
  }));
}

/** English, for callers with no translator to hand. */
export const TASTE_OPTIONS: ReadonlyArray<TasteOption> = tasteOptions();

export interface BrewSuggestion {
  /** Warm, optional, never an instruction (§10.2 autonomy). */
  text: string;
  field: BrewField;
  delta: number;
}

export interface PaybackLine {
  /** The one honest line shown straight after logging. Never a streak (§10.3). */
  line: string;
  suggestion?: BrewSuggestion;
}

const ORDINALS = ['0th', '1st', '2nd', '3rd'];

export function ordinal(n: number): string {
  if (n < 4 && n >= 0) return ORDINALS[n] ?? `${n}th`;
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/**
 * Spanish ordinals, feminine — they agree with "preparación".
 *
 * This one piece of vocabulary lives in code rather than the message catalogue
 * because it is a numeral system, not copy: the same list would serve any
 * sentence that counts something feminine, and splitting it across ten
 * catalogue keys would only obscure that. Past ten, Spanish stops reaching for
 * an ordinal word in casual speech — "la preparación 27" is what somebody
 * actually says — so this returns null and the caller uses the plain form.
 */
const ES_ORDINALS_FEMININE = [
  'Primera',
  'Segunda',
  'Tercera',
  'Cuarta',
  'Quinta',
  'Sexta',
  'Séptima',
  'Octava',
  'Novena',
  'Décima',
];

/** An ordinal word for `n`, or null when the language would rather use a digit. */
export function ordinalWord(n: number, locale: Locale): string | null {
  if (locale === 'en') return ordinal(n);
  return ES_ORDINALS_FEMININE[n - 1] ?? null;
}

function verdictScore(verdict: TasteVerdict | undefined): number | null {
  if (!verdict) return null;
  return verdict === 'good' ? 1 : 0;
}

/**
 * "Are the ratings trending up?" — answered honestly or not at all.
 * Needs at least two rated brews in each window, and only ever claims an
 * improvement, never a decline (a bad run is not something to announce).
 */
export function ratingsTrendingUp(verdicts: Array<TasteVerdict | undefined>): boolean {
  const scored = verdicts.map(verdictScore).filter((v): v is number => v !== null);
  if (scored.length < 4) return false;
  const half = Math.floor(scored.length / 2);
  const earlier = scored.slice(0, half);
  const recent = scored.slice(scored.length - half);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return mean(recent) > mean(earlier);
}

/**
 * The suggestion attached to each unhappy verdict.
 *
 * `field` and `delta` are behaviour — they are what "Apply it" actually does —
 * so they stay here. Only `text` is copy, and it is looked up per call rather
 * than baked in, because the same suggestion has to arrive in the reader's
 * language.
 */
const SUGGESTION_BY_VERDICT: Record<
  TasteVerdict,
  { key: MessageKey; field: BrewField; delta: number } | undefined
> = {
  bitter: { key: 'brew.suggestBitter', field: 'grind', delta: STEP.grind },
  sour: { key: 'brew.suggestSour', field: 'grind', delta: -STEP.grind },
  weak: { key: 'brew.suggestWeak', field: 'grind', delta: -STEP.grind },
  good: undefined,
};


/**
 * The single line of payback the card shows after a log (§6).
 *
 * Rules: progress not streaks; no shaming; never a claim the data does not
 * support. `priorVerdicts` is oldest-first and covers this bag only.
 */
export function buildPayback(
  input: {
    brewCountForBag: number;
    verdict: TasteVerdict | null;
    priorVerdicts: Array<TasteVerdict | undefined>;
    changed: BrewField[];
  },
  /** Omit for English. Every existing caller does, and gets what it always got. */
  options: { t?: Translator; locale?: Locale } = {},
): PaybackLine {
  const t = options.t ?? EN;
  const locale = options.locale ?? DEFAULT_LOCALE;
  const count = Math.max(1, input.brewCountForBag);

  const word = ordinalWord(count, locale);
  const nth =
    word === null
      ? t('brew.paybackNthPlain', { n: count })
      : t('brew.paybackNth', { ordinal: word, n: count });

  if (input.verdict && input.verdict !== 'good') {
    const found = SUGGESTION_BY_VERDICT[input.verdict];
    if (!found) return { line: t('brew.paybackPlain', { nth }) };
    const suggestion: BrewSuggestion = {
      text: t(found.key),
      field: found.field,
      delta: found.delta,
    };
    return { line: t('brew.paybackWith', { nth, suggestion: suggestion.text }), suggestion };
  }

  const all = [...input.priorVerdicts, input.verdict ?? undefined];
  if (input.verdict === 'good' && ratingsTrendingUp(all)) {
    return { line: t('brew.paybackTrending', { nth }) };
  }
  if (input.verdict === 'good') {
    return { line: t('brew.paybackGood', { nth }) };
  }
  if (input.changed.length === 1) {
    return { line: t('brew.paybackOneThing', { nth }) };
  }
  return { line: t('brew.paybackPlain', { nth }) };
}

/* ------------------------------------------------------------------ *
 * Instrumentation (§7) — the 15s bar has to be measured, not asserted
 * ------------------------------------------------------------------ */

export const TIME_TO_LOG_EVENT = 'brewcult:time-to-log';

export interface TimeToLogMeasurement {
  /** Which of the three paths produced the log. */
  path: 'A' | 'B' | 'C';
  source: BrewSource;
  session_id: string;
  /** Card open → persisted locally. This is the §7 metric. */
  ms: number;
  /** First interaction → persisted locally, for when the card sat idle. */
  ms_since_first_input: number;
  /** Taps/keystrokes that reached the logger. Path A should read 1. */
  interactions: number;
  /** True when the log went into the queue rather than straight to the API. */
  offline: boolean;
}

export interface LogTimer {
  noteInteraction(): void;
  interactions(): number;
  /** Milliseconds since the card opened. */
  elapsed(): number;
  measure(input: Omit<TimeToLogMeasurement, 'ms' | 'ms_since_first_input' | 'interactions'>): TimeToLogMeasurement;
  reset(): void;
}

/** Starts the clock when the card opens (§7: "from tapping Log a brew"). */
export function createLogTimer(now: () => number = () => Date.now()): LogTimer {
  let openedAt = now();
  let firstInputAt: number | null = null;
  let interactions = 0;

  return {
    noteInteraction() {
      interactions += 1;
      firstInputAt ??= now();
    },
    interactions: () => interactions,
    elapsed: () => now() - openedAt,
    measure(input) {
      const at = now();
      return {
        ...input,
        ms: at - openedAt,
        ms_since_first_input: at - (firstInputAt ?? at),
        interactions,
      };
    },
    reset() {
      openedAt = now();
      firstInputAt = null;
      interactions = 0;
    },
  };
}

/**
 * Publish a measurement.
 *
 * Today: a DOM CustomEvent (so any page-level collector can listen without the
 * logger importing it) plus the caller's callback, and a dev-only console line.
 * Next: the same payload becomes the `brew.logged` client event body POSTed to
 * the product-events endpoint (BREW-08 / EF §5.2) — one call site, right here.
 */
export function emitTimeToLog(
  measurement: TimeToLogMeasurement,
  onMeasure?: (measurement: TimeToLogMeasurement) => void,
): void {
  onMeasure?.(measurement);

  if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent(TIME_TO_LOG_EVENT, { detail: measurement }));
  }

  if (process.env.NODE_ENV !== 'production' && typeof console !== 'undefined') {
    // Dev-only readout of the §7 metric; production reports it through the
    // event above (and BREW-08's endpoint next), never the console.
    // eslint-disable-next-line no-console
    console.info(
      `[brewcult] time-to-log path ${measurement.path}: ${(measurement.ms / 1000).toFixed(2)}s ` +
        `(${measurement.interactions} interaction${measurement.interactions === 1 ? '' : 's'}` +
        `${measurement.offline ? ', offline' : ''})`,
    );
  }
}
