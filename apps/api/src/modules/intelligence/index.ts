/**
 * INTELLIGENCE MODULE — PUBLIC INTERFACE (EF §1.2; backlog AI-01..AI-10;
 * second_draft §7, §16).
 *
 * This file is the module's entire contract. `.dependency-cruiser.cjs` makes any
 * import of `modules/intelligence/<anything-else>` from outside a hard error.
 *
 * Wiring in `apps/api/src/app.ts` is two lines (see README.md — this lane may
 * not edit app.ts):
 *
 *     import { registerIntelligenceRoutes } from './modules/intelligence/index.js';
 *     await registerIntelligenceRoutes(app);
 *
 * Route map:
 *   POST /v1/ai/diagnose          brew session + taste -> ONE adjustment, grounded,
 *                                 with the reasoning              -> DiagnoseResult
 *   POST /v1/ai/starting-recipe   coffee + the person's equipment -> a brewable
 *                                 recipe, saying which basis it used
 *                                                                 -> StartingRecipeResult
 *   POST /v1/ai/chat              SSE, tool-using conversation
 *                                 events: token | tool | done | error
 *   GET  /v1/ai/usage             today's token spend + the daily cap
 *
 * All four are authenticated and budget-checked. Exceeding the daily cap is a
 * 429 with `error: "ai_budget_exhausted"` and human-written copy (AI-10).
 *
 * What other lanes should know:
 *   * Model output is ALWAYS sanitized markdown. Never render it as HTML.
 *   * Every entity the answer refers to has been resolved through an allowlist
 *     (must exist AND be visible to the requester), so `entities[].href` is safe
 *     to link. Ids the model invented are silently dropped.
 *   * Answers carry `grounding.basis` and `grounding.note`. Show the note —
 *     "no community data yet" is a product principle (§7.2), not an error state.
 *   * `usage` on every response is what the budget meter renders.
 */

import type { FastifyInstance } from 'fastify';
import { registerIntelligencePolicies } from './policies.js';
import {
  registerIntelligenceRoutes as registerRoutes,
  type IntelligenceRouteOptions,
} from './routes.js';

/**
 * Registers the intelligence policies and every AI route.
 *
 * Policies first and unconditionally: an unregistered resource type is
 * inaccessible (default deny), so routes without policies would 403 silently.
 */
export async function registerIntelligenceRoutes(
  app: FastifyInstance,
  options: IntelligenceRouteOptions = {},
): Promise<void> {
  registerIntelligencePolicies();
  await registerRoutes(app, options);
}

export type { IntelligenceRouteOptions } from './routes.js';

// --- policy surface --------------------------------------------------------

export {
  AI_ASSISTANT_RESOURCE,
  INTELLIGENCE_RESOURCE_TYPES,
  aiAssistantPolicy,
  registerIntelligencePolicies,
  type IntelligenceResourceType,
} from './policies.js';

// --- gateway (AI-01) -------------------------------------------------------

export {
  AiBudgetExceededError,
  AiGateway,
  AnthropicProvider,
  BUDGET_EXHAUSTED_MESSAGE,
  FEATURE_ROUTES,
  MODELS,
  dailyBudgetFor,
  routeFor,
  type FeatureRoute,
  type GatewayCall,
  type GatewayOptions,
  type GatewayResult,
} from './gateway.js';

/** The injectable fake. Exported so the eval suites and other lanes can use it. */
export {
  FakeAiProvider,
  dialInFrom,
  instructionChannel,
  requesterContext,
  type FakeAiProviderOptions,
  type FakeCall,
  type ObeyedDirective,
} from './provider-fake.js';

// --- token accounting (AI-01 / AI-10) --------------------------------------

export {
  InMemoryUsageStore,
  billableTokens,
  dayKey,
  defaultUsageStore,
  type UsageRecord,
  type UsageStore,
} from './usage.js';

// --- prompt architecture (AI-03) + untrusted discipline (EF §3.4) ----------

export {
  FEATURE_SYSTEM,
  SYSTEM_CORE,
  SYSTEM_PROMPT_VERSION,
  UntrustedFence,
  assemble,
  assertStablePrefix,
  breakpointIndex,
  containsPii,
  isInsideFence,
  neutralise,
  scrub,
  scrubDeep,
  scrubPii,
  stablePrefixOf,
  type AssembleInput,
  type AssembledPrompt,
  type UntrustedSource,
} from './prompts/index.js';

// --- tool layer (AI-02) ----------------------------------------------------

export {
  SeenEntities,
  TOOL_NAMES,
  TOOL_SPECS,
  executeTool,
  findTool,
  toolDefinitions,
  type ToolContext,
  type ToolExecution,
  type ToolSpec,
} from './tools/index.js';

// --- output handling (AI-08) -----------------------------------------------

export {
  isSafeHref,
  resolveOutput,
  sanitizeMarkdown,
  type ResolveOptions,
  type ResolvedOutput,
} from './output.js';

// --- features (AI-04/05/06) ------------------------------------------------

export {
  DIAGNOSE_SCHEMA,
  MAX_TOOL_ITERATIONS,
  STARTING_RECIPE_SCHEMA,
  chat,
  diagnose,
  startingRecipe,
  type ChatEvent,
  type ChatInput,
  type DiagnoseInput,
  type FeatureDeps,
  type StartingRecipeInput,
} from './features.js';

// --- types -----------------------------------------------------------------

export type {
  AiContentBlock,
  AiEffort,
  AiFeature,
  AiMessage,
  AiPlan,
  AiProvider,
  AiRequest,
  AiResponse,
  AiStopReason,
  AiStreamEvent,
  AiTextBlock,
  AiToolDefinition,
  AiUsage,
  AiUsageReport,
  DialInSuggestion,
  DiagnoseResult,
  EntityReference,
  GroundingReport,
  IntelligenceDb,
  StartingRecipeResult,
} from './types.js';

/**
 * Drafting a catalogue entry from a pasted description.
 *
 * Exported because the review queue lives in `admin` (which already owns
 * moderation queues) and admin may import intelligence — whereas intelligence
 * already imports brewing and catalog, so putting the queue in either of those
 * would close a cycle. Composition points one way (engineering_foundations §9.5).
 */
export {
  draftEquipment,
  isPublishable,
  EQUIPMENT_DRAFT_SCHEMA,
  type EquipmentDraft,
  type EquipmentDraftInput,
  type EquipmentDraftDeps,
} from './equipment-draft.js';

/**
 * The OpenAI provider, for callers that build their own gateway.
 *
 * Production runs AI_PROVIDER=openai, so a consumer selecting a provider needs
 * this one too — exporting only Anthropic would silently give the review queue
 * a different model from the rest of the product.
 */
export { OpenAiProvider } from './provider-openai.js';
