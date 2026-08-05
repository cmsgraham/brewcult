/**
 * AI gateway — AI-01, second_draft §16.1.
 *
 * Three jobs, and nothing else:
 *   1. THE PROVIDER SEAM. `AiProvider` is the only surface the rest of this
 *      module talks to. `AnthropicProvider` is the real implementation; tests
 *      inject `FakeAiProvider` (provider-fake.ts). We do NOT mock the SDK — the
 *      live code path below is fully written and runs the instant a key is set.
 *   2. PER-FEATURE MODEL ROUTING (the §16.1 table), adaptive thinking, and the
 *      effort level each feature is worth.
 *   3. BUDGET + ACCOUNTING. Every call is budget-checked before it goes out and
 *      metered after it comes back — AI-10, and EF §3.4's cost-abuse control.
 *
 * ── Model / parameter facts this file depends on ────────────────────────────
 *  * Model ids are exact strings with no date suffix.
 *  * `thinking: { type: 'adaptive' }`. `budget_tokens` was removed and is a 400.
 *  * Depth is `output_config.effort`, NESTED — not a top-level field.
 *  * `temperature` / `top_p` / `top_k` are removed on these models: sending any
 *    of them is a 400. `AiRequest` has no field for them on purpose. Steering is
 *    the system prompt's job (prompts/system.ts).
 *  * Structured output is `output_config.format = { type: 'json_schema', … }`,
 *    not the deprecated top-level `output_format`.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { getEnv } from '../../lib/env.js';
import { ApiError } from '../../lib/errors.js';
import { billableTokens, dayKey, defaultUsageStore, type UsageStore } from './usage.js';
import {
  EMPTY_USAGE,
  type AiContentBlock,
  type AiEffort,
  type AiFeature,
  type AiPlan,
  type AiProvider,
  type AiRequest,
  type AiResponse,
  type AiStopReason,
  type AiStreamEvent,
  type AiTextBlock,
  type AiToolDefinition,
  type AiUsage,
  type AiUsageReport,
} from './types.js';

// ---------------------------------------------------------------------------
// Model routing (second_draft §16.1)
// ---------------------------------------------------------------------------

/**
 * Exact model ids. No date suffixes — these strings are complete as written.
 */
export const MODELS = {
  /** Default tier: dial-in advice, diagnostics, recipe generation, chat. */
  default: 'claude-sonnet-5',
  /** Premium tier — §16.1 "Opus-class for premium". */
  premium: 'claude-opus-5',
  /** Cheap classification / triage. */
  cheap: 'claude-haiku-4-5',
} as const;

export interface FeatureRoute {
  feature: AiFeature;
  model: string;
  /** Premium plans get the Opus-class model for the same feature. */
  premiumModel: string;
  effort: AiEffort;
  /** Adaptive thinking, or none for the cheap classifier. */
  thinking: boolean;
  maxTokens: number;
}

/**
 * THE routing table. One row per feature; premium swaps the model only.
 *
 * Effort rationale: dial-in and starting-recipe answers are short but the
 * reasoning has to be right (a wrong causal direction is worse than no answer),
 * so `high`. Chat is interactive and latency-visible, so `medium`. Classify is
 * a labelling task on a cheap model, so `low` with no thinking.
 */
export const FEATURE_ROUTES: Readonly<Record<AiFeature, FeatureRoute>> = {
  diagnose: {
    feature: 'diagnose',
    model: MODELS.default,
    premiumModel: MODELS.premium,
    effort: 'high',
    thinking: true,
    maxTokens: 2_000,
  },
  starting_recipe: {
    feature: 'starting_recipe',
    model: MODELS.default,
    premiumModel: MODELS.premium,
    effort: 'high',
    thinking: true,
    maxTokens: 2_000,
  },
  chat: {
    feature: 'chat',
    model: MODELS.default,
    premiumModel: MODELS.premium,
    effort: 'medium',
    thinking: true,
    maxTokens: 4_000,
  },
  classify: {
    feature: 'classify',
    model: MODELS.cheap,
    premiumModel: MODELS.cheap,
    effort: 'low',
    thinking: false,
    maxTokens: 512,
  },
};

export const routeFor = (feature: AiFeature, plan: AiPlan = 'free'): FeatureRoute => {
  const route = FEATURE_ROUTES[feature];
  return plan === 'premium' ? { ...route, model: route.premiumModel } : route;
};

// ---------------------------------------------------------------------------
// Budget (AI-10 / EF §3.4 cost abuse)
// ---------------------------------------------------------------------------

/**
 * 429 with copy a human wrote. AI-10's acceptance criterion is explicitly
 * "friendly limit message, not error", so the message is part of the contract
 * and a test asserts on it.
 */
export const BUDGET_EXHAUSTED_MESSAGE =
  "You've used up today's AI allowance. It resets at midnight UTC — until then " +
  'your brew log, recipes and the grind converter all still work as normal.';

export class AiBudgetExceededError extends ApiError {
  constructor(readonly report: AiUsageReport) {
    super(429, 'ai_budget_exhausted', BUDGET_EXHAUSTED_MESSAGE, {
      daily_tokens_used: report.daily_tokens_used,
      daily_token_limit: report.daily_token_limit,
      resets_at: `${dayKey(new Date(Date.now() + 86_400_000))}T00:00:00Z`,
    });
  }
}

export const dailyBudgetFor = (plan: AiPlan): number =>
  // Phase 1 issues only the free tier; premium multiplies the same env knob so
  // there is exactly one number to tune (AI-10 / §16.1 "premium unlocks heavier
  // usage").
  plan === 'premium'
    ? getEnv().AI_DAILY_TOKEN_BUDGET_FREE * 10
    : getEnv().AI_DAILY_TOKEN_BUDGET_FREE;

// ---------------------------------------------------------------------------
// The gateway
// ---------------------------------------------------------------------------

export interface GatewayOptions {
  provider: AiProvider;
  usage?: UsageStore;
}

export interface GatewayCall {
  feature: AiFeature;
  userId: string;
  plan?: AiPlan;
  system: AiTextBlock[];
  tools?: AiToolDefinition[];
  messages: AiRequest['messages'];
  /** Structured-output schema, when the feature needs one. */
  jsonSchema?: Record<string, unknown>;
  /** Override the routed cap (a tool loop turn may want a smaller one). */
  maxTokens?: number;
}

export interface GatewayResult {
  content: AiContentBlock[];
  stop_reason: AiStopReason;
  model: string;
  usage: AiUsage;
  report: AiUsageReport;
}

export class AiGateway {
  private readonly usage: UsageStore;

  constructor(private readonly options: GatewayOptions) {
    this.usage = options.usage ?? defaultUsageStore;
  }

  get provider(): AiProvider {
    return this.options.provider;
  }

  get usageStore(): UsageStore {
    return this.usage;
  }

  /**
   * Assembles the provider request for a call. Exported behaviour (not just an
   * internal detail) because the prompt-assembly unit tests assert on the exact
   * shape — cache breakpoint position, absence of sampling params, adaptive
   * thinking, effort nesting.
   */
  buildRequest(call: GatewayCall): AiRequest {
    const route = routeFor(call.feature, call.plan ?? 'free');
    const request: AiRequest = {
      model: route.model,
      max_tokens: call.maxTokens ?? route.maxTokens,
      system: call.system,
      messages: call.messages,
    };
    if (call.tools && call.tools.length > 0) request.tools = call.tools;
    if (route.thinking) request.thinking = { type: 'adaptive' };

    const output_config: AiRequest['output_config'] = { effort: route.effort };
    if (call.jsonSchema) {
      output_config.format = { type: 'json_schema', schema: call.jsonSchema };
    }
    request.output_config = output_config;
    return request;
  }

  /** Throws `AiBudgetExceededError` when today's allowance is already spent. */
  async assertWithinBudget(userId: string, plan: AiPlan = 'free'): Promise<AiUsageReport> {
    const limit = dailyBudgetFor(plan);
    const used = await this.usage.totalForDay(userId);
    const report = this.report(EMPTY_USAGE, used, limit);
    if (used >= limit) throw new AiBudgetExceededError(report);
    return report;
  }

  /** One non-streaming provider turn: budget → call → meter. */
  async complete(call: GatewayCall): Promise<GatewayResult> {
    const plan = call.plan ?? 'free';
    await this.assertWithinBudget(call.userId, plan);
    const request = this.buildRequest(call);

    let response: AiResponse;
    try {
      response = await this.options.provider.createMessage(request);
    } catch (err) {
      throw translateProviderError(err);
    }

    return this.settle(call.userId, call.feature, plan, response);
  }

  /**
   * One streaming provider turn. Yields text deltas as they arrive and a final
   * `result` event; accounting happens when the stream completes.
   */
  async *stream(
    call: GatewayCall,
  ): AsyncGenerator<{ type: 'text_delta'; text: string } | { type: 'result'; result: GatewayResult }> {
    const plan = call.plan ?? 'free';
    await this.assertWithinBudget(call.userId, plan);
    const request = this.buildRequest(call);

    let final: AiResponse | null = null;
    try {
      for await (const event of this.options.provider.streamMessage(request)) {
        if (event.type === 'text_delta') yield { type: 'text_delta', text: event.text };
        else final = event.message;
      }
    } catch (err) {
      throw translateProviderError(err);
    }
    if (!final) throw new ApiError(502, 'ai_provider_error', 'The model stream ended early.');

    yield { type: 'result', result: await this.settle(call.userId, call.feature, plan, final) };
  }

  private async settle(
    userId: string,
    feature: AiFeature,
    plan: AiPlan,
    response: AiResponse,
  ): Promise<GatewayResult> {
    await this.usage.record(userId, feature, response.usage);
    const used = await this.usage.totalForDay(userId);
    return {
      content: response.content,
      stop_reason: response.stop_reason,
      model: response.model,
      usage: response.usage,
      report: this.report(response.usage, used, dailyBudgetFor(plan)),
    };
  }

  private report(usage: AiUsage, used: number, limit: number): AiUsageReport {
    return {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      daily_tokens_used: used,
      daily_token_limit: limit,
      daily_tokens_remaining: Math.max(0, limit - used),
    };
  }
}

/** Total tokens a single response cost, for logging. */
export const responseCost = (usage: AiUsage): number => billableTokens(usage);

/**
 * Provider failures become HTTP errors the shared handler understands, and
 * never leak the provider's message verbatim in production.
 */
function translateProviderError(err: unknown): Error {
  if (err instanceof ApiError) return err;
  const status = (err as { status?: number })?.status;
  if (status === 429) {
    return new ApiError(
      503,
      'ai_unavailable',
      'The brew assistant is busy right now. Try again in a moment.',
    );
  }
  if (typeof status === 'number' && status >= 500) {
    return new ApiError(502, 'ai_provider_error', 'The brew assistant is unavailable.');
  }
  return new ApiError(
    502,
    'ai_provider_error',
    err instanceof Error ? `Model call failed: ${err.message}` : 'Model call failed.',
  );
}

// ---------------------------------------------------------------------------
// The real provider
// ---------------------------------------------------------------------------

/**
 * Anthropic implementation of the seam.
 *
 * The SDK client is created lazily and the module is imported dynamically, so
 * an API process with no ANTHROPIC_API_KEY still boots, still serves every
 * non-AI route, and only fails when an AI endpoint is actually called.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private client: Anthropic | null = null;

  constructor(private readonly apiKey: string = getEnv().ANTHROPIC_API_KEY) {}

  private async sdk(): Promise<Anthropic> {
    if (this.client) return this.client;
    if (!this.apiKey) {
      throw new ApiError(
        503,
        'ai_unconfigured',
        'The brew assistant is not configured on this deployment.',
      );
    }
    const mod = await import('@anthropic-ai/sdk');
    const Ctor = mod.default;
    this.client = new Ctor({ apiKey: this.apiKey });
    return this.client;
  }

  async createMessage(request: AiRequest): Promise<AiResponse> {
    const client = await this.sdk();
    const message = await client.messages.create(toSdkParams(request));
    return fromSdkMessage(message);
  }

  async *streamMessage(request: AiRequest): AsyncIterable<AiStreamEvent> {
    const client = await this.sdk();
    const stream = client.messages.stream(toSdkParams(request));
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text_delta', text: event.delta.text };
      }
    }
    yield { type: 'message', message: fromSdkMessage(await stream.finalMessage()) };
  }
}

/**
 * Seam → SDK. THE only place in the codebase that constructs SDK params.
 *
 * Render order is tools → system → messages, which is why the cache breakpoint
 * that `prompts/assemble.ts` places on the last system block also covers every
 * tool definition ahead of it.
 */
export function toSdkParams(request: AiRequest): Anthropic.MessageCreateParamsNonStreaming {
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: request.model,
    max_tokens: request.max_tokens,
    system: request.system.map((block) => ({
      type: 'text' as const,
      text: block.text,
      ...(block.cache_control ? { cache_control: { type: 'ephemeral' as const } } : {}),
    })),
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content.map(toSdkBlock),
    })),
  };

  if (request.tools) {
    params.tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema as Anthropic.Tool.InputSchema,
      ...(tool.cache_control ? { cache_control: { type: 'ephemeral' as const } } : {}),
    }));
  }
  // Adaptive only. `{ type: 'enabled', budget_tokens: N }` is a 400 on these models.
  if (request.thinking) params.thinking = { type: 'adaptive' };
  if (request.output_config) {
    params.output_config = {
      ...(request.output_config.effort ? { effort: request.output_config.effort } : {}),
      ...(request.output_config.format
        ? {
            format: {
              type: 'json_schema' as const,
              schema: request.output_config.format.schema as Record<string, unknown>,
            },
          }
        : {}),
    } satisfies Anthropic.OutputConfig;
  }
  // Intentionally never set: temperature / top_p / top_k (removed → 400).
  return params;
}

function toSdkBlock(block: AiContentBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: [{ type: 'text', text: block.content }],
        ...(block.is_error ? { is_error: true } : {}),
      };
  }
}

/** SDK → seam. Thinking blocks are dropped: nothing downstream may read them. */
export function fromSdkMessage(message: Anthropic.Message): AiResponse {
  const content: AiContentBlock[] = [];
  for (const block of message.content) {
    if (block.type === 'text') content.push({ type: 'text', text: block.text });
    else if (block.type === 'tool_use') {
      content.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: (block.input ?? {}) as Record<string, unknown>,
      });
    }
  }
  return {
    model: message.model,
    stop_reason: (message.stop_reason ?? 'end_turn') as AiStopReason,
    content,
    usage: {
      input_tokens: message.usage.input_tokens ?? 0,
      output_tokens: message.usage.output_tokens ?? 0,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
    },
  };
}
