/**
 * OpenAI implementation of the `AiProvider` seam.
 *
 * WHY THIS EXISTS: second_draft §16 chose Anthropic, and `AnthropicProvider` is
 * still the reference implementation — the prompts, the grounding behaviour and
 * the injection evals were tuned against it. This adapter exists because the
 * operator already holds an OpenAI key and wants to run the assistant on it.
 * The seam is what makes that a file rather than a refactor: tools, prompts,
 * policies, budgets, output sanitisation and the eval suite are all untouched.
 *
 * SELECTION: `AI_PROVIDER=openai` (env). Anything else keeps Anthropic.
 *
 * The four places the two APIs genuinely differ, and how each is handled:
 *
 *  1. SYSTEM PROMPT — Anthropic takes an array of blocks with cache breakpoints;
 *     OpenAI takes a single system message. The blocks are concatenated in
 *     order, which preserves the stable-prefix LAYOUT (assemble.ts still puts
 *     stable content first), so OpenAI's automatic prefix caching can still hit.
 *  2. CACHE CONTROL — there is no explicit breakpoint. `cache_control` markers
 *     are dropped and cache accounting is reported from `prompt_tokens_details`
 *     when the API supplies it, otherwise zero. A zero cache_read here means
 *     "not reported", NOT "the prefix layout is broken" — the Anthropic-side
 *     assertion in the eval harness remains the real check on layout.
 *  3. THINKING / EFFORT — `thinking: {type:'adaptive'}` has no direct analogue.
 *     `output_config.effort` maps onto `reasoning_effort` for models that accept
 *     it; for models that do not, both are omitted rather than guessed at.
 *  4. TOOLS — same idea, different envelope: Anthropic's `tool_use` blocks and
 *     `tool_result` blocks become OpenAI `tool_calls` and `role:'tool'`
 *     messages. Tool ARGUMENTS arrive as a JSON string and are parsed here, so
 *     the rest of the module keeps seeing `input` as an object.
 *
 * The module's security properties are provider-independent by construction:
 * authorization happens in the tool layer before any provider is reached, and
 * output sanitisation happens after. Nothing here can weaken either.
 */

import { getEnv } from '../../lib/env.js';
import { ApiError } from '../../lib/errors.js';
import {
  EMPTY_USAGE,
  type AiContentBlock,
  type AiImageBlock,
  type AiMessage,
  type AiProvider,
  type AiRequest,
  type AiResponse,
  type AiStopReason,
  type AiStreamEvent,
  type AiTextBlock,
  type AiToolUseBlock,
  type AiUsage,
} from './types.js';

/** Models that accept `reasoning_effort`. Others get neither it nor thinking. */
const REASONING_MODELS = /^(o[134]|gpt-5)/;

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** A multi-part user message: text plus images. */
type OpenAiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | OpenAiContentPart[] | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

interface OpenAiChoice {
  message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
  delta?: { content?: string | null; tool_calls?: unknown };
  finish_reason?: string | null;
}

interface OpenAiResponseBody {
  model?: string;
  choices?: OpenAiChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

function systemText(blocks: AiTextBlock[]): string {
  // Order is preserved: assemble.ts already puts stable content first, which is
  // what any prefix-caching implementation keys on.
  return blocks.map((b) => b.text).join('\n\n');
}

/** Anthropic content blocks -> OpenAI chat messages. */
function toOpenAiMessages(system: AiTextBlock[], messages: AiMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: 'system', content: systemText(system) }];

  for (const message of messages) {
    const text = message.content
      .filter((b): b is AiTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    const toolUses = message.content.filter((b): b is AiToolUseBlock => b.type === 'tool_use');
    const toolResults = message.content.filter(
      (b): b is Extract<AiContentBlock, { type: 'tool_result' }> => b.type === 'tool_result',
    );

    // Tool results are their own messages in OpenAI's shape, and must come
    // before any further user text so the call/result pairing stays adjacent.
    for (const result of toolResults) {
      out.push({ role: 'tool', tool_call_id: result.tool_use_id, content: result.content });
    }

    if (message.role === 'assistant') {
      if (text || toolUses.length > 0) {
        out.push({
          role: 'assistant',
          content: text || null,
          ...(toolUses.length > 0
            ? {
                tool_calls: toolUses.map((use) => ({
                  id: use.id,
                  type: 'function' as const,
                  function: { name: use.name, arguments: JSON.stringify(use.input) },
                })),
              }
            : {}),
        });
      }
    } else {
      // Images force the multi-part shape. Text stays FIRST: the fenced
      // data-not-instructions preamble has to be read before anything an image
      // might have written on it.
      const images = message.content.filter((b): b is AiImageBlock => b.type === 'image');
      if (images.length > 0) {
        out.push({
          role: 'user',
          content: [
            ...(text ? [{ type: 'text' as const, text }] : []),
            ...images.map((image) => ({
              type: 'image_url' as const,
              image_url: { url: image.url },
            })),
          ],
        });
      } else if (text) {
        out.push({ role: 'user', content: text });
      }
    }
  }

  return out;
}

function toStopReason(finish: string | null | undefined): AiStopReason {
  switch (finish) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    default:
      return 'end_turn';
  }
}

function toUsage(usage: OpenAiResponseBody['usage']): AiUsage {
  if (!usage) return EMPTY_USAGE;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    // Report the UNCACHED remainder as input, matching Anthropic's split, so the
    // budget meter counts the same thing on both providers.
    input_tokens: Math.max(0, (usage.prompt_tokens ?? 0) - cached),
    output_tokens: usage.completion_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached,
  };
}

function toContent(choice: OpenAiChoice | undefined): AiContentBlock[] {
  const blocks: AiContentBlock[] = [];
  const text = choice?.message?.content;
  if (typeof text === 'string' && text.length > 0) blocks.push({ type: 'text', text });

  for (const call of choice?.message?.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(call.function.arguments || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        input = parsed as Record<string, unknown>;
      }
    } catch {
      // A model that emits malformed arguments gets an empty object rather than
      // a thrown request; the tool layer validates inputs anyway.
    }
    blocks.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
  }

  return blocks;
}

export interface OpenAiProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;

  constructor(options: OpenAiProviderOptions = {}) {
    const env = getEnv();
    this.apiKey = options.apiKey ?? env.OPENAI_API_KEY;
    this.baseUrl = (options.baseUrl ?? env.OPENAI_BASE_URL).replace(/\/+$/, '');
    this.doFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  private body(request: AiRequest, stream: boolean): Record<string, unknown> {
    const model = request.model;
    const body: Record<string, unknown> = {
      model,
      messages: toOpenAiMessages(request.system, request.messages),
      max_completion_tokens: request.max_tokens,
    };

    if (request.tools && request.tools.length > 0) {
      body['tools'] = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        },
      }));
    }

    const effort = request.output_config?.effort;
    if (effort && REASONING_MODELS.test(model)) {
      // OpenAI's scale has no xhigh/max; both clamp to high.
      body['reasoning_effort'] = effort === 'xhigh' || effort === 'max' ? 'high' : effort;
    }

    const format = request.output_config?.format;
    if (format) {
      body['response_format'] = {
        type: 'json_schema',
        json_schema: { name: 'brewcult_result', strict: false, schema: format.schema },
      };
    }

    if (stream) {
      body['stream'] = true;
      body['stream_options'] = { include_usage: true };
    }
    return body;
  }

  private async call(request: AiRequest, stream: boolean): Promise<Response> {
    if (!this.apiKey) {
      // Same shape the Anthropic provider uses, so an unconfigured deployment
      // answers identically whichever provider is selected — and the web client
      // already treats 503 as "not switched on yet".
      throw new ApiError(
        503,
        'ai_unconfigured',
        'The brew assistant is not configured on this deployment.',
      );
    }
    const res = await this.doFetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(this.body(request, stream)),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // Deliberately does not echo the request: it carries user brew context.
      throw new Error(`openai request failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    return res;
  }

  async createMessage(request: AiRequest): Promise<AiResponse> {
    const res = await this.call(request, false);
    const body = (await res.json()) as OpenAiResponseBody;
    const choice = body.choices?.[0];
    return {
      model: body.model ?? request.model,
      stop_reason: toStopReason(choice?.finish_reason),
      content: toContent(choice),
      usage: toUsage(body.usage),
    };
  }

  async *streamMessage(request: AiRequest): AsyncIterable<AiStreamEvent> {
    const res = await this.call(request, true);
    const reader = res.body?.getReader();
    if (!reader) {
      // No stream available: fall back to a single-shot call so callers still
      // get a terminal `message` event rather than an empty stream.
      yield { type: 'message', message: await this.createMessage(request) };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let model = request.model;
    let finish: string | null | undefined;
    let usage: AiUsage = EMPTY_USAGE;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;

        let frame: OpenAiResponseBody;
        try {
          frame = JSON.parse(payload) as OpenAiResponseBody;
        } catch {
          continue; // A partial frame; the buffer keeps the remainder.
        }
        if (frame.model) model = frame.model;
        if (frame.usage) usage = toUsage(frame.usage);
        const choice = frame.choices?.[0];
        if (choice?.finish_reason) finish = choice.finish_reason;
        const delta = choice?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          text += delta;
          yield { type: 'text_delta', text: delta };
        }
      }
    }

    yield {
      type: 'message',
      message: {
        model,
        stop_reason: toStopReason(finish),
        content: text ? [{ type: 'text', text }] : [],
        usage,
      },
    };
  }
}
