/**
 * Intelligence module — internal types and the provider/database seams.
 *
 * The provider types here are DELIBERATELY NOT the Anthropic SDK's types. They
 * are the seam (second_draft §16.1 "provider-agnostic gateway, but concretely
 * Anthropic Claude API as primary"): `gateway.ts` owns the single translation
 * from these shapes to the SDK, and every test injects a fake that implements
 * this interface instead of mocking the SDK. That way the live path is never
 * stubbed — swapping the fake for `AnthropicProvider` is the only difference
 * between a CI run and a real one.
 */

import type { ExtractionDiagnosis, TasteResult } from '@brewcult/shared-types';

export type { ExtractionDiagnosis, TasteResult };

// ---------------------------------------------------------------------------
// Database seam
// ---------------------------------------------------------------------------

export interface QueryResultLike<T> {
  rows: T[];
}

/**
 * The narrow slice of a Postgres client this module needs. It is structurally
 * compatible with both `BrewingDb` and `CatalogDb`, which is what lets one
 * injected object serve every cross-module read helper we call.
 *
 * This module owns NO tables. Every read goes through catalog's or brewing's
 * public interface; there is no SQL in this folder at all.
 */
export interface IntelligenceDb {
  query<T>(text: string, params?: readonly unknown[]): Promise<QueryResultLike<T>>;
}

// ---------------------------------------------------------------------------
// Provider seam — request
// ---------------------------------------------------------------------------

/** Effort levels (`output_config.effort`). NOT a top-level request field. */
export type AiEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface CacheControl {
  type: 'ephemeral';
}

export interface AiTextBlock {
  type: 'text';
  text: string;
  /** Prompt-caching breakpoint. Only ever set on the LAST stable block. */
  cache_control?: CacheControl;
}

export interface AiToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AiToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type AiContentBlock = AiTextBlock | AiToolUseBlock | AiToolResultBlock;

export interface AiMessage {
  role: 'user' | 'assistant';
  content: AiContentBlock[];
}

export interface AiToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** Cache breakpoint. Tools render FIRST, so a breakpoint here covers them. */
  cache_control?: CacheControl;
}

export interface AiJsonSchemaFormat {
  type: 'json_schema';
  schema: Record<string, unknown>;
}

export interface AiOutputConfig {
  /** Depth control. `budget_tokens` does not exist on these models. */
  effort?: AiEffort;
  format?: AiJsonSchemaFormat;
}

/**
 * A provider request.
 *
 * Note what is ABSENT and must stay absent: `temperature`, `top_p`, `top_k` are
 * removed on the models we route to and are a 400 if sent. Steering happens in
 * the prompt (`prompts/system.ts`).
 */
export interface AiRequest {
  model: string;
  max_tokens: number;
  /** Stable blocks first; the cache breakpoint sits on the last one. */
  system: AiTextBlock[];
  tools?: AiToolDefinition[];
  messages: AiMessage[];
  /** Adaptive only. `{ type: 'enabled', budget_tokens }` is a 400. */
  thinking?: { type: 'adaptive' };
  output_config?: AiOutputConfig;
}

// ---------------------------------------------------------------------------
// Provider seam — response
// ---------------------------------------------------------------------------

export interface AiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  /** > 0 on a repeat call proves the breakpoint placement works (AI-03). */
  cache_read_input_tokens: number;
}

export const EMPTY_USAGE: AiUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

export type AiStopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'stop_sequence'
  | 'refusal'
  | 'pause_turn';

export interface AiResponse {
  model: string;
  stop_reason: AiStopReason;
  content: AiContentBlock[];
  usage: AiUsage;
}

export type AiStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'message'; message: AiResponse };

/**
 * The provider seam. `AnthropicProvider` is the real implementation;
 * `FakeAiProvider` is the deterministic one every test injects.
 */
export interface AiProvider {
  readonly name: string;
  createMessage(request: AiRequest): Promise<AiResponse>;
  streamMessage(request: AiRequest): AsyncIterable<AiStreamEvent>;
}

// ---------------------------------------------------------------------------
// Features and routing
// ---------------------------------------------------------------------------

/** Every distinct AI workload. Accounting and routing are keyed by this. */
export type AiFeature = 'diagnose' | 'starting_recipe' | 'chat' | 'classify';

export const AI_FEATURES: readonly AiFeature[] = [
  'diagnose',
  'starting_recipe',
  'chat',
  'classify',
];

/** Which plan the caller is on. Free is the only tier Phase 1 issues. */
export type AiPlan = 'free' | 'premium';

// ---------------------------------------------------------------------------
// Wire shapes (what the web lane consumes)
// ---------------------------------------------------------------------------

/** Per-request usage echoed to the client so the UI can show the budget. */
export interface AiUsageReport {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  /** Tokens this user has spent today across every feature. */
  daily_tokens_used: number;
  daily_token_limit: number;
  daily_tokens_remaining: number;
}

/** An entity the answer refers to, AFTER allowlist resolution (EF §3.4). */
export interface EntityReference {
  type: 'coffee' | 'recipe' | 'equipment' | 'brew';
  /** Slug for coffees (catalog's public identifier), uuid for the rest. */
  id: string;
  label: string;
  /** Client-resolvable path. Never a model-authored URL. */
  href: string;
}

/** One adjustment. §7.2 rule 2: dial-in changes exactly ONE variable. */
export interface DialInSuggestion {
  variable: 'grind' | 'temperature' | 'time' | 'ratio' | 'dose' | 'agitation' | 'none';
  direction: 'finer' | 'coarser' | 'hotter' | 'cooler' | 'longer' | 'shorter' | 'more' | 'less' | 'hold';
  /** Human-readable target, e.g. "6.0 on your Ode (from 6.5)". */
  target: string | null;
}

export interface DiagnoseResult {
  diagnosis: ExtractionDiagnosis;
  suggestion: DialInSuggestion;
  /** Sanitized markdown. Never HTML, never executed. */
  advice_markdown: string;
  /** §7.1 "explanation on demand" — why, not just what. */
  reasoning_markdown: string;
  /** §7.2 rule 3 — uncertainty is spoken aloud. */
  confidence: 'low' | 'medium' | 'high';
  grounding: GroundingReport;
  entities: EntityReference[];
  usage: AiUsageReport;
}

/** Which basis the answer stands on (§7.2 rule 1: say when the graph is silent). */
export interface GroundingReport {
  basis:
    | 'roaster_official_recipe'
    | 'community_recipes'
    | 'user_brew_history'
    | 'general_priors';
  /** How many graph rows the answer actually stands on. */
  sample_size: number;
  /** Literal copy shown to the user when the graph has nothing. */
  note: string;
}

export interface StartingRecipeResult {
  method: string;
  dose_g: number | null;
  water_g: number | null;
  ratio: number | null;
  temperature_c: number | null;
  brew_time_s: number | null;
  grind_category: string;
  grind_setting: string | null;
  rationale_markdown: string;
  confidence: 'low' | 'medium' | 'high';
  grounding: GroundingReport;
  entities: EntityReference[];
  usage: AiUsageReport;
}
