/** Prompt architecture barrel (AI-03 / EF §3.4). */

export { SYSTEM_CORE, FEATURE_SYSTEM, SYSTEM_PROMPT_VERSION } from './system.js';
export {
  assemble,
  assertStablePrefix,
  breakpointIndex,
  stablePrefixOf,
  type AssembleInput,
  type AssembledPrompt,
} from './assemble.js';
export {
  UntrustedFence,
  isInsideFence,
  neutralise,
  type UntrustedSource,
} from './untrusted.js';
export { containsPii, scrub, scrubDeep, scrubPii, type PiiScrubResult } from './pii.js';
