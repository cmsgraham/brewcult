/**
 * Secret generation and hashing primitives for the identity module.
 *
 * Two hash regimes, chosen by the entropy of what is being hashed:
 *
 *  - HIGH ENTROPY (refresh tokens 256-bit, reset tokens 256-bit, recovery codes
 *    160-bit): SHA-256. There is nothing to brute-force, so a slow KDF would buy
 *    nothing but latency on every refresh. Storing hashes still means a database
 *    dump alone cannot be replayed against the API (DG §7.2).
 *  - LOW ENTROPY (the 6-digit email verification code): Argon2id, plus a hard
 *    attempt cap and a 15-minute expiry. 10^6 is trivially searchable offline.
 *
 * Comparison of hashes is timing-safe throughout.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** URL-safe random token. 32 bytes = 256 bits. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256, hex encoded — the at-rest form of every high-entropy secret. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time string compare that tolerates differing lengths. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so the early return is not a length oracle.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * A 6-digit numeric verification code, uniformly distributed (`randomInt` uses
 * rejection sampling — `randomBytes() % 1000000` would be biased).
 */
export function generateNumericCode(digits = 6): string {
  const max = 10 ** digits;
  return String(randomInt(0, max)).padStart(digits, '0');
}

/**
 * Recovery code: 160 bits rendered as `xxxxx-xxxxx-xxxxx-xxxxx` in Crockford-ish
 * base32 without vowels, so a human can transcribe it without ambiguity or
 * accidentally spelling something unfortunate.
 */
const RECOVERY_ALPHABET = '0123456789BCDFGHJKLMNPQRSTVWXZ';

export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g += 1) {
    let group = '';
    for (let i = 0; i < 5; i += 1) {
      group += RECOVERY_ALPHABET[randomInt(0, RECOVERY_ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join('-');
}

/** Normalises a user-typed recovery code (case, spacing, stray dashes). */
export function normaliseRecoveryCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** Canonical email form. Lower-cased so behaviour matches the citext columns
 *  even on a database where citext is unavailable. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Canonical handle form: handles are case-insensitive identifiers (citext). */
export function normaliseHandle(handle: string): string {
  return handle.trim().toLowerCase();
}
