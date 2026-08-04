/**
 * Identity module — pure-logic unit tests (no database, no HTTP).
 *
 * The DB-backed and HTTP-level behaviour lives in `identity.test.ts`; this file
 * covers the primitives those flows are built out of, where a bug is cheapest
 * to find: password policy, lockout backoff, secret generation, TOTP, and the
 * object policies themselves.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ANONYMOUS, authorize, can, resetPolicies, type Actor } from '../src/lib/policy.js';
import {
  backoffSeconds,
  LOCKOUT_THRESHOLD,
} from '../src/modules/identity/login-attempts.js';
import {
  MFA_REQUIRED_ROLES,
  currentTotpToken,
  generateTotpSecret,
  mfaRequiredForRole,
  totpUri,
  verifyTotp,
} from '../src/modules/identity/mfa.js';
import {
  checkPasswordPolicy,
  checkPasswordShape,
  hashPassword,
  resetBreachChecker,
  setBreachChecker,
  verifyPassword,
} from '../src/modules/identity/passwords.js';
import {
  SESSION_RESOURCE,
  USER_RESOURCE,
  registerIdentityPolicies,
} from '../src/modules/identity/policies.js';
import {
  generateNumericCode,
  generateRecoveryCode,
  generateToken,
  hashToken,
  normaliseEmail,
  normaliseHandle,
  normaliseRecoveryCode,
  safeEqual,
} from '../src/modules/identity/secrets.js';
import type { SessionResource, UserResource } from '../src/modules/identity/types.js';

describe('password hashing (EF §2.3 — Argon2id)', () => {
  it('produces an Argon2id hash that verifies and is salted per call', async () => {
    const a = await hashPassword('a-perfectly-fine-passphrase');
    const b = await hashPassword('a-perfectly-fine-passphrase');

    expect(a.startsWith('$argon2id$')).toBe(true);
    expect(a).not.toBe(b); // distinct salts
    expect(await verifyPassword(a, 'a-perfectly-fine-passphrase')).toBe(true);
    expect(await verifyPassword(a, 'a-perfectly-fine-passphras')).toBe(false);
  });

  it('treats a null or corrupt hash as a failed verification, never a throw', async () => {
    expect(await verifyPassword(null, 'anything')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });
});

describe('password policy (ID-02)', () => {
  beforeEach(() => resetBreachChecker());

  it('enforces the length floor and ceiling', () => {
    expect(checkPasswordShape('short').ok).toBe(false);
    expect(checkPasswordShape('x'.repeat(129)).ok).toBe(false);
    expect(checkPasswordShape('x'.repeat(12)).ok).toBe(true);
  });

  it('rejects passwords containing the account identifiers', () => {
    const context = { email: 'grinder@example.com', handle: 'grinder' };
    expect(checkPasswordShape('my-grinder-password', context).ok).toBe(false);
    expect(checkPasswordShape('MY-GRINDER-PASSWORD', context).ok).toBe(false);
    expect(checkPasswordShape('unrelated-passphrase', context).ok).toBe(true);
  });

  it('rejects passwords on the breach list and honours a pluggable checker', async () => {
    expect((await checkPasswordPolicy('correcthorsebatterystaple')).ok).toBe(false);

    setBreachChecker((password) => password === 'a-unique-looking-phrase');
    expect((await checkPasswordPolicy('a-unique-looking-phrase')).ok).toBe(false);
    expect((await checkPasswordPolicy('correcthorsebatterystaple')).ok).toBe(true);
    resetBreachChecker();
  });
});

describe('lockout backoff (EF §3.3)', () => {
  it('does nothing below the threshold and then doubles, capped at 15 minutes', () => {
    expect(backoffSeconds(LOCKOUT_THRESHOLD - 1)).toBe(0);
    expect(backoffSeconds(5)).toBe(30);
    expect(backoffSeconds(6)).toBe(60);
    expect(backoffSeconds(7)).toBe(120);
    expect(backoffSeconds(50)).toBe(900);
  });
});

describe('secret primitives', () => {
  it('hashes tokens deterministically and irreversibly', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toHaveLength(64);
    expect(hashToken(token)).not.toContain(token);
  });

  it('generates distinct, URL-safe, high-entropy tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('compares in constant time and still gets the answer right', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('produces 6-digit verification codes across the whole range', () => {
    const codes = Array.from({ length: 500 }, () => generateNumericCode());
    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    // Leading zeros must survive — a code stringified from a number would lose them.
    expect(codes.every((c) => c.length === 6)).toBe(true);
  });

  it('produces transcribable recovery codes and normalises user input', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[0-9BCDFGHJKLMNPQRSTVWXZ]{5}(-[0-9BCDFGHJKLMNPQRSTVWXZ]{5}){3}$/);
    expect(normaliseRecoveryCode(` ${code.toLowerCase()} `)).toBe(code.replace(/-/g, ''));
  });

  it('canonicalises emails and handles the same way citext would', () => {
    expect(normaliseEmail('  Alice@Example.COM ')).toBe('alice@example.com');
    expect(normaliseHandle(' AliceBrews ')).toBe('alicebrews');
  });
});

describe('TOTP (ID-07)', () => {
  it('generates a secret and an otpauth URI an authenticator app can consume', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/); // base32
    const uri = totpUri(secret, 'brewer@example.com');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain('issuer=BrewCult');
  });

  it('accepts a fresh code and rejects a malformed or wrong one', async () => {
    const secret = generateTotpSecret();
    const token = await currentTotpToken(secret);

    expect((await verifyTotp(secret, token, null)).valid).toBe(true);
    expect((await verifyTotp(secret, 'abcdef', null)).valid).toBe(false);
    expect((await verifyTotp(secret, '1234567', null)).valid).toBe(false);
    expect((await verifyTotp(generateTotpSecret(), token, null)).valid).toBe(false);
  });

  it('refuses to accept the same code twice (replay protection)', async () => {
    const secret = generateTotpSecret();
    const token = await currentTotpToken(secret);

    const first = await verifyTotp(secret, token, null);
    expect(first.valid).toBe(true);
    expect(typeof first.timeStep).toBe('number');

    const replay = await verifyTotp(secret, token, first.timeStep ?? 0);
    expect(replay.valid).toBe(false);
  });

  it('flags the roles that must carry MFA', () => {
    expect(MFA_REQUIRED_ROLES).toContain('admin');
    expect(mfaRequiredForRole('admin')).toBe(true);
    expect(mfaRequiredForRole('moderator')).toBe(true);
    expect(mfaRequiredForRole('user')).toBe(false);
    expect(mfaRequiredForRole(null)).toBe(false);
  });
});

describe('identity object policies (EF §3.2, ID-08)', () => {
  const alice: Actor = { userId: 'u-alice', role: 'user' };
  const bob: Actor = { userId: 'u-bob', role: 'user' };
  const admin: Actor = { userId: 'u-admin', role: 'admin', mfa: true };
  const adminNoMfa: Actor = { userId: 'u-admin', role: 'admin' };
  const moderator: Actor = { userId: 'u-mod', role: 'moderator', mfa: true };

  const aliceUser: UserResource = { id: 'u-alice', status: 'active', role: 'user' };
  const adminUser: UserResource = { id: 'u-admin', status: 'active', role: 'admin' };
  const aliceSession: SessionResource = { familyId: 'fam-1', userId: 'u-alice' };

  beforeEach(() => {
    resetPolicies();
    registerIdentityPolicies();
  });

  it('registers idempotently, so building several apps does not explode', () => {
    expect(() => registerIdentityPolicies()).not.toThrow();
  });

  it('lets a user update only their own profile', async () => {
    expect(await can(alice, 'update', USER_RESOURCE, aliceUser)).toBe(true);
    expect(await can(bob, 'update', USER_RESOURCE, aliceUser)).toBe(false);
    expect(await can(bob, 'delete', USER_RESOURCE, aliceUser)).toBe(false);
  });

  it('does not let staff quietly edit someone else’s profile', async () => {
    // Staff act through `moderate`, which is audit-logged; `update` is the
    // subject's own action and stays theirs.
    expect(await can(admin, 'update', USER_RESOURCE, aliceUser)).toBe(false);
    expect(await can(admin, 'moderate', USER_RESOURCE, aliceUser)).toBe(true);
  });

  it('gates staff moderation on an MFA-backed session', async () => {
    expect(await can(admin, 'moderate', USER_RESOURCE, aliceUser)).toBe(true);
    expect(await can(adminNoMfa, 'moderate', USER_RESOURCE, aliceUser)).toBe(false);
  });

  it('stops a moderator escalating an admin and stops anyone moderating themselves', async () => {
    expect(await can(moderator, 'moderate', USER_RESOURCE, adminUser)).toBe(false);
    expect(await can(admin, 'moderate', USER_RESOURCE, adminUser)).toBe(false);
    expect(await can(admin, 'moderate', USER_RESOURCE, aliceUser)).toBe(true);
  });

  it('hides suspended and deleted profiles from third parties', async () => {
    const suspended: UserResource = { id: 'u-alice', status: 'suspended', role: 'user' };
    expect(await can(bob, 'read', USER_RESOURCE, suspended)).toBe(false);
    expect(await can(alice, 'read', USER_RESOURCE, suspended)).toBe(true);
    expect(await can(admin, 'read', USER_RESOURCE, suspended)).toBe(true);
    expect(await can(bob, 'read', USER_RESOURCE, aliceUser)).toBe(true);
  });

  it('keeps sessions private to their owner — staff included', async () => {
    expect(await can(alice, 'delete', SESSION_RESOURCE, aliceSession)).toBe(true);
    expect(await can(bob, 'delete', SESSION_RESOURCE, aliceSession)).toBe(false);
    expect(await can(admin, 'read', SESSION_RESOURCE, aliceSession)).toBe(false);
    expect(await can(ANONYMOUS, 'list', SESSION_RESOURCE)).toBe(false);
  });

  it('answers 401 for anonymous callers and 403 for authenticated ones', async () => {
    await expect(authorize(ANONYMOUS, 'update', USER_RESOURCE, aliceUser)).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(authorize(bob, 'update', USER_RESOURCE, aliceUser)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
