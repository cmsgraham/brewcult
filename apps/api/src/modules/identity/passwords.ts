/**
 * Password hashing and strength policy — EF §2.3, backlog ID-02.
 *
 * Argon2id via @node-rs/argon2 (prebuilt binaries, so `npm ci` on Windows and
 * on the Alpine build image both work without a toolchain). Parameters follow
 * OWASP's Argon2id guidance: 19 MiB memory, 2 iterations, 1 lane.
 */
import { randomBytes } from 'node:crypto';
import { type Algorithm, hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

/**
 * `Algorithm.Argon2id`. The upstream declaration is an ambient `const enum`,
 * which `isolatedModules` (tsconfig.base.json) forbids importing as a value, so
 * the numeric member is pinned here instead. 2 === Argon2id; a change would be a
 * breaking change in @node-rs/argon2 and is asserted by the unit tests, which
 * check that produced hashes carry the `$argon2id$` prefix.
 */
const ARGON2ID = 2 as Algorithm;

const ARGON_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456, // KiB (19 MiB) — OWASP minimum for Argon2id
  timeCost: 2,
  parallelism: 1,
} as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTIONS);
}

/** Verifies a password. Never throws for a wrong password — returns false. */
export async function verifyPassword(hash: string | null, password: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await argonVerify(hash, password, ARGON_OPTIONS);
  } catch {
    return false; // corrupted or foreign-format hash
  }
}

/**
 * Argon2id hash of an unguessable process-local string, computed once on first
 * use. Login burns a verify against it when the account does not exist (or is
 * OAuth-only), so "unknown account" costs the same wall-clock time as "wrong
 * password" — otherwise the timing difference is a free enumeration oracle.
 * It must be a *real* hash: a syntactically invalid one would be rejected
 * before the KDF runs and burn no time at all.
 */
let dummyHash: Promise<string> | null = null;

export async function burnPasswordVerify(): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
  await verifyPassword(await dummyHash, 'timing-equalisation-only');
}

/**
 * Offline breach/common-password denylist (ID-02 "breach-list check").
 *
 * Deliberately local: the registration path must not depend on a third-party
 * HTTP call being up, and shipping outbound requests derived from user
 * passwords is its own privacy question. `setBreachChecker()` lets ops plug in
 * a k-anonymity HIBP range client later without touching this module's callers.
 */
const COMMON_PASSWORDS = new Set(
  [
    'password',
    'password1',
    'password123',
    'password1234',
    'passw0rd123',
    '123456789012',
    '1234567890123',
    'qwertyuiop123',
    'qwerty123456',
    'iloveyou1234',
    'letmein12345',
    'welcome12345',
    'admin1234567',
    'administrator',
    'trustno1trustno1',
    'monkey123456',
    'dragon123456',
    'football1234',
    'baseball1234',
    'sunshine1234',
    'princess1234',
    'coffee123456',
    'espresso1234',
    'brewcult1234',
    'changemechangeme',
    'correcthorsebatterystaple',
  ].map((p) => p.toLowerCase()),
);

export type BreachChecker = (password: string) => Promise<boolean> | boolean;

let breachChecker: BreachChecker = (password) => COMMON_PASSWORDS.has(password.toLowerCase());

/** Replaces the breach check (e.g. with an HIBP k-anonymity client). */
export function setBreachChecker(checker: BreachChecker): void {
  breachChecker = checker;
}

/** Restores the built-in offline denylist. */
export function resetBreachChecker(): void {
  breachChecker = (password) => COMMON_PASSWORDS.has(password.toLowerCase());
}

export interface PasswordPolicyContext {
  email?: string;
  handle?: string;
  displayName?: string | null;
}

export interface PasswordPolicyResult {
  ok: boolean;
  reason?: string;
}

/** Synchronous structural checks (length + personal-information reuse). */
export function checkPasswordShape(
  password: string,
  context: PasswordPolicyContext = {},
): PasswordPolicyResult {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, reason: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.` };
  }
  // ASVS 2.1.7: no composition rules, but reject passwords containing the
  // account's own identifiers — those are the first thing an attacker tries.
  const lower = password.toLowerCase();
  const localPart = context.email?.split('@')[0]?.toLowerCase();
  const candidates = [localPart, context.handle?.toLowerCase(), context.displayName?.toLowerCase()];
  for (const candidate of candidates) {
    if (candidate && candidate.length >= 4 && lower.includes(candidate)) {
      return { ok: false, reason: 'Password must not contain your name, handle or email address.' };
    }
  }
  return { ok: true };
}

/** Full policy: shape checks plus the breach/common-password list. */
export async function checkPasswordPolicy(
  password: string,
  context: PasswordPolicyContext = {},
): Promise<PasswordPolicyResult> {
  const shape = checkPasswordShape(password, context);
  if (!shape.ok) return shape;
  if (await breachChecker(password)) {
    return { ok: false, reason: 'This password appears in a known breach or common-password list.' };
  }
  return { ok: true };
}
