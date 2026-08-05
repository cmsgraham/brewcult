/**
 * Outbound PII guard — AI-09, EF §3.4 ("minimal payloads to the LLM: send
 * taste-profile features and entity data, not emails, names, or free-form PII")
 * and EF §4.4 (the provider is a processor; what we never send, they never hold).
 *
 * This is DEFENCE IN DEPTH, not the primary control. The primary control is that
 * the tool layer projects entity rows into narrow DTOs that have no email, no
 * handle and no display name in them at all (tools/registry.ts). This guard is
 * the second line: it runs over every byte of outbound context — tool results,
 * user free text, assembled per-user blocks — so a future field addition that
 * leaks an email fails loudly in a test instead of quietly in production.
 *
 * Design rules:
 *  - REDACT, never drop. `[redacted:email]` keeps the sentence readable and tells
 *    the model something was removed, which is better than a confusing gap.
 *  - Prefer false positives. Redacting a coffee named "info@" is a cosmetic bug;
 *    leaking a user's email is a privacy incident.
 *  - The ONE carve-out is structural identifiers (see `PRESERVE`), because
 *    redacting an entity id would break grounding without protecting anybody.
 *  - No allowlist of "safe" domains. That is how these guards rot.
 */

export interface PiiRedaction {
  kind: string;
  count: number;
}

export interface PiiScrubResult {
  text: string;
  redactions: PiiRedaction[];
}

interface Pattern {
  kind: string;
  re: RegExp;
}

/**
 * Ordering matters: emails are matched before bare @handles so that
 * `anna@example.com` is redacted once as an email rather than twice.
 */
const PATTERNS: readonly Pattern[] = [
  { kind: 'email', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  // Card-shaped digit runs (13–19 digits, optionally grouped). Before `phone`,
  // which would otherwise claim the leading chunk.
  { kind: 'card', re: /\b(?:\d[ -]?){13,19}\b/g },
  // E.164 and common national formats. Requires 9+ digits so brew params
  // ("94", "165", "1:16") and settings ("6.5") are never touched.
  { kind: 'phone', re: /(?<![\w.])\+?\d[\d\s().-]{8,}\d(?![\w.])/g },
  { kind: 'handle', re: /(?<![\w/])@[A-Za-z0-9_]{2,30}\b/g },
  { kind: 'ip', re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  // JWT / bearer-looking secrets that could ride in on pasted content.
  { kind: 'token', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g },
  { kind: 'url_credentials', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@\S+/gi },
];

/**
 * Shapes that are STRUCTURAL, not personal, and must survive the scrubber:
 * entity uuids and ISO-8601 timestamps.
 *
 * This is not a nicety. A UUIDv7 whose hex happens to be all digits —
 * `01890301-0000-7000-8000-000000000301`, exactly what our client-minted ids
 * look like — is a perfect match for the card-number pattern. Redacting it
 * would silently break every entity reference in the prompt and every allowlist
 * lookup downstream, while protecting nobody.
 *
 * They are masked before the patterns run and restored afterwards, so this is a
 * carve-out for a known-safe shape rather than a hole in a pattern.
 */
const PRESERVE: readonly RegExp[] = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g,
];

/** Placeholder for a preserved token. Pure letters + a small index, so no PII
 *  pattern can match it and restoring it disturbs no surrounding whitespace. */
const keepToken = (index: number): string => `zzKEEPzz${index}zzENDzz`;
const KEEP_TOKEN = /zzKEEPzz(\d+)zzENDzz/g;

/** Redacts every known PII pattern from `text`. */
export function scrubPii(text: string): PiiScrubResult {
  const preserved: string[] = [];
  let out = text;
  for (const re of PRESERVE) {
    out = out.replace(re, (match) => keepToken(preserved.push(match) - 1));
  }

  const redactions: PiiRedaction[] = [];
  for (const { kind, re } of PATTERNS) {
    let count = 0;
    out = out.replace(re, () => {
      count += 1;
      return `[redacted:${kind}]`;
    });
    if (count > 0) redactions.push({ kind, count });
  }

  out = out.replace(KEEP_TOKEN, (_match, index: string) => preserved[Number(index)] ?? '');
  return { text: out, redactions };
}

/** Convenience for call sites that only want the cleaned string. */
export const scrub = (text: string): string => scrubPii(text).text;

/**
 * Recursively scrubs every string in a JSON-serialisable value. Used on tool
 * results before they are stringified into the transcript, so a nested note
 * field is covered exactly like a top-level one.
 *
 * Object KEYS are left alone: they are our own schema names, never user data.
 */
export function scrubDeep<T>(value: T): T {
  if (typeof value === 'string') return scrub(value) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}

/** True when the text still contains something the guard would redact. */
export const containsPii = (text: string): boolean => scrubPii(text).redactions.length > 0;
