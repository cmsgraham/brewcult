/**
 * Intelligence HTTP surface — AI-04, AI-05, AI-06, AI-10.
 *
 * Handlers do four things and nothing else: validate the body, resolve the
 * actor, call a function in `features.ts`, and shape the response. Every
 * authorization decision, every graph read and every model call happens below
 * this file — the same discipline brewing's routes follow.
 *
 * All three routes are authenticated (`requireAuth`) and budget-checked (the
 * gateway does it, and the 429 propagates through the shared error handler with
 * the friendly copy AI-10 asks for).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '../../lib/auth-plugin.js';
import { badRequest } from '../../lib/errors.js';
import { ANONYMOUS, type Actor } from '../../lib/policy.js';
import { AiGateway, AnthropicProvider } from './gateway.js';
import { chat, diagnose, startingRecipe, type ChatEvent } from './features.js';
import { chatBody, diagnoseBody, issuesOf, startingRecipeBody } from './schemas.js';
import { defaultUsageStore, type UsageStore } from './usage.js';
import type { AiPlan, AiProvider, IntelligenceDb } from './types.js';
import { query as poolQuery } from '../../lib/db.js';

export interface IntelligenceRouteOptions {
  /** Database seam; defaults to the shared pool. Tests inject PGlite. */
  db?: IntelligenceDb;
  /** Provider seam; defaults to the real Anthropic client. Tests inject a fake. */
  provider?: AiProvider;
  usage?: UsageStore;
  prefix?: string;
  /** Plan resolution. Phase 1 has no paid tier, so everyone is free. */
  planFor?: (actor: Actor) => AiPlan;
}

const defaultDb: IntelligenceDb = {
  query: async <T>(text: string, params: readonly unknown[] = []) =>
    poolQuery(text, params) as unknown as Promise<{ rows: T[] }>,
};

const actorOf = (request: FastifyRequest): Actor =>
  (request as FastifyRequest & { actor?: Actor }).actor ?? ANONYMOUS;

const authed = { preHandler: [requireAuth] };

export async function registerIntelligenceRoutes(
  app: FastifyInstance,
  options: IntelligenceRouteOptions = {},
): Promise<void> {
  const db = options.db ?? defaultDb;
  const provider = options.provider ?? new AnthropicProvider();
  const gateway = new AiGateway({ provider, usage: options.usage ?? defaultUsageStore });
  const prefix = options.prefix ?? '/v1';
  const planFor = options.planFor ?? (() => 'free' as const);

  // -------------------------------------------------------------------------
  // POST /v1/ai/diagnose — AI-06
  // -------------------------------------------------------------------------
  app.post(`${prefix}/ai/diagnose`, authed, async (request) => {
    const parsed = diagnoseBody.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid request.', issuesOf(parsed.error));
    const actor = actorOf(request);
    return diagnose(actor, parsed.data, { gateway, db, plan: planFor(actor) });
  });

  // -------------------------------------------------------------------------
  // POST /v1/ai/starting-recipe — AI-05
  // -------------------------------------------------------------------------
  app.post(`${prefix}/ai/starting-recipe`, authed, async (request) => {
    const parsed = startingRecipeBody.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid request.', issuesOf(parsed.error));
    const actor = actorOf(request);
    return startingRecipe(actor, parsed.data, { gateway, db, plan: planFor(actor) });
  });

  // -------------------------------------------------------------------------
  // POST /v1/ai/chat — AI-04, SSE
  // -------------------------------------------------------------------------
  //
  // Streaming detail worth knowing on the web side: the budget check happens
  // BEFORE the first byte, so an exhausted budget is a normal JSON 429 and not
  // an SSE `error` event. Once the stream has started, failures arrive as an
  // `error` event because the status line is already sent.
  app.post(`${prefix}/ai/chat`, authed, async (request, reply) => {
    const parsed = chatBody.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid request.', issuesOf(parsed.error));
    const actor = actorOf(request);

    // Fail loudly before hijacking the reply, so budget/authz errors keep their
    // proper status codes.
    await gateway.assertWithinBudget(actor.userId ?? '', planFor(actor));

    const stream = chat(actor, parsed.data, { gateway, db, plan: planFor(actor) });
    return sendSse(reply, stream, request);
  });

  // -------------------------------------------------------------------------
  // GET /v1/ai/usage — AI-01/AI-10: what the UI needs to render the allowance
  // -------------------------------------------------------------------------
  app.get(`${prefix}/ai/usage`, authed, async (request) => {
    const actor = actorOf(request);
    const userId = actor.userId as string;
    const report = await gateway
      .assertWithinBudget(userId, planFor(actor))
      .catch((err: unknown) => {
        // An exhausted budget is a valid state for this read-only endpoint.
        const report = (err as { report?: unknown }).report;
        if (report) return report as Awaited<ReturnType<AiGateway['assertWithinBudget']>>;
        throw err;
      });
    return {
      ...report,
      by_feature: await gateway.usageStore.breakdownForDay(userId),
    };
  });
}

/**
 * Writes an SSE response. Uses `reply.hijack()` + `reply.raw` so Fastify does
 * not try to serialise anything after us.
 *
 * Event names: `token` (a text delta), `tool` (a tool ran — the UI can show
 * "checking your brew history"), `done` (final sanitized text + entities +
 * usage), `error`.
 */
async function sendSse(
  reply: FastifyReply,
  stream: AsyncGenerator<ChatEvent>,
  request: FastifyRequest,
): Promise<void> {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Nginx buffers SSE into uselessness without this.
    'X-Accel-Buffering': 'no',
  });

  const send = (event: string, data: unknown): void => {
    raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    for await (const event of stream) {
      if (event.type === 'token') send('token', { text: event.text });
      else if (event.type === 'tool') send('tool', { name: event.name, ok: event.ok });
      else send('done', { text: event.text, entities: event.entities, usage: event.usage });
    }
  } catch (err) {
    request.log.error({ err }, 'ai chat stream failed');
    send('error', {
      error: (err as { code?: string }).code ?? 'ai_error',
      message:
        err instanceof Error && (err as { statusCode?: number }).statusCode
          ? err.message
          : 'The brew assistant stopped unexpectedly.',
    });
  } finally {
    raw.end();
  }
}
