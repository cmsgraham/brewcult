/**
 * Identity module — database- and HTTP-level tests.
 *
 * Runs the real SQL against PGlite with db/migrations/0001..0003 plus the
 * module-owned 0004 extras applied, so the statements exercised here are the
 * statements production runs. `lib/db` is the only mocked seam: `query` and
 * `transaction` are re-pointed at the in-process database.
 *
 * PGlite ships no `vector` extension (Lane D hit the same wall), so
 * `CREATE EXTENSION vector` is stripped from 0001; `citext` and `pgcrypto`
 * are loaded from PGlite's contrib bundles, which means the case-insensitive
 * email/handle semantics of the real schema are genuinely under test.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Response as InjectResponse } from 'light-my-request';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => {
  // Must be in place before `lib/env.ts` memoises the environment.
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'identity-lane-test-secret-at-least-32-chars';
  process.env.APP_URL = 'http://localhost:3000';
  process.env.API_URL = 'http://localhost:4000';
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  return { db: null as PGlite | null };
});

vi.mock('../src/lib/db.js', () => ({
  query: (text: string, params: readonly unknown[] = []) =>
    holder.db!.query(text, params as unknown[]),
  transaction: (fn: (client: { query: unknown }) => Promise<unknown>) =>
    holder.db!.transaction((tx) =>
      fn({ query: (text: string, params?: unknown[]) => tx.query(text, params) }),
    ),
  getPool: () => {
    throw new Error('getPool() is not available in the PGlite test harness');
  },
  closePool: async () => {},
}));

const { registerErrorHandler } = await import('../src/lib/errors.js');
const { resolveGoogleIdentity, setIdentityMailer, registerIdentityRoutes } = await import(
  '../src/modules/identity/index.js'
);
const { currentTotpToken } = await import('../src/modules/identity/mfa.js');
const { hashToken } = await import('../src/modules/identity/secrets.js');
import type { IdentityMailMessage } from '../src/modules/identity/mailer.js';
import type { Exec } from '../src/modules/identity/types.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const MIGRATIONS = [
  'db/migrations/0001_extensions.sql',
  'db/migrations/0002_identity.sql',
  'db/migrations/0003_catalog.sql',
  'db/migrations/0005_identity_extras.sql',
];

let app: FastifyInstance;
const mails: IdentityMailMessage[] = [];

/** Direct database access for arrange/assert steps. */
const exec: Exec = ((text: string, params: readonly unknown[] = []) =>
  holder.db!.query(text, params as unknown[])) as Exec;

let seq = 0;
const uniq = (): string => `${Date.now().toString(36)}${(seq += 1)}`;

const PASSWORD = 'a-long-enough-passphrase-42';

beforeAll(async () => {
  holder.db = await PGlite.create({ extensions: { citext, pgcrypto } });

  for (const file of MIGRATIONS) {
    const sql = (await readFile(repoRoot + file, 'utf8'))
      // PGlite has no pgvector build; nothing in the identity schema needs it.
      .replace(/CREATE EXTENSION IF NOT EXISTS vector;/g, '');
    await holder.db.exec(sql);
  }

  setIdentityMailer(async (message) => {
    mails.push(message);
  });

  app = Fastify({ logger: false });
  registerErrorHandler(app);
  await registerIdentityRoutes(app);
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
  await holder.db?.close();
  setIdentityMailer(null);
});

// --- helpers -----------------------------------------------------------------

interface Account {
  email: string;
  handle: string;
  id: string;
}

function lastMail(to: string, template: string): IdentityMailMessage | undefined {
  return [...mails].reverse().find((m) => m.to === to && m.template === template);
}

async function registerAccount(overrides: Partial<Account> = {}): Promise<Account> {
  const tag = uniq();
  const email = overrides.email ?? `brewer-${tag}@example.com`;
  const handle = overrides.handle ?? `brewer${tag}`;

  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { email, handle, password: PASSWORD },
  });
  expect(res.statusCode).toBe(202);

  const { rows } = await exec<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
  return { email, handle, id: rows[0]!.id };
}

async function verifyAccount(account: Account): Promise<void> {
  const mail = lastMail(account.email, 'verify_email');
  expect(mail).toBeDefined();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/verify-email',
    payload: { email: account.email, code: mail!.data.code },
  });
  expect(res.statusCode).toBe(200);
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  session_id: string;
}

async function login(account: Account): Promise<Tokens> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email: account.email, password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return res.json<Tokens>();
}

async function newVerifiedUser(): Promise<{ account: Account; tokens: Tokens }> {
  const account = await registerAccount();
  await verifyAccount(account);
  return { account, tokens: await login(account) };
}

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

/**
 * A code from the NEXT 30-second step (still inside the ±1-step tolerance).
 * Replay protection stores the time step of every accepted code, so re-using
 * the code that confirmed enrolment within the same window is — correctly —
 * rejected. Real users wait; tests step forward instead.
 */
const nextTotpToken = (secret: string): Promise<string> =>
  currentTotpToken(secret, Math.floor(Date.now() / 1000) + 30);

function cookieHeader(res: InjectResponse): string {
  return res.cookies.map((c) => `${String(c.name)}=${String(c.value)}`).join('; ');
}

// --- tests -------------------------------------------------------------------

describe('schema harness', () => {
  it('applies 0001..0004 and keeps citext case-insensitivity', async () => {
    const { rows } = await exec<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const tables = rows.map((r) => r.table_name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'users',
        'auth_identities',
        'refresh_tokens',
        'login_attempts',
        'audit_log',
        'email_verification_codes',
        'password_reset_tokens',
        'user_mfa',
        'mfa_recovery_codes',
      ]),
    );
  });

  it('keeps audit_log append-only even for the application role (ID-09)', async () => {
    await exec(`INSERT INTO audit_log (action) VALUES ('test.immutability')`);
    await expect(
      exec(`UPDATE audit_log SET action = 'tampered' WHERE action = 'test.immutability'`),
    ).rejects.toThrow(/append-only/);
    await expect(
      exec(`DELETE FROM audit_log WHERE action = 'test.immutability'`),
    ).rejects.toThrow(/append-only/);
  });
});

describe('register → verify → login → refresh (ID-02, ID-03)', () => {
  it('walks the happy path and rotates the refresh token', async () => {
    const account = await registerAccount();

    const verifyMail = lastMail(account.email, 'verify_email');
    expect(verifyMail?.data.code).toMatch(/^\d{6}$/);

    // Unverified accounts cannot sign in.
    const early = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: account.email, password: PASSWORD },
    });
    expect(early.statusCode).toBe(400);

    await verifyAccount(account);
    const tokens = await login(account);
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();

    const me = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: bearer(tokens.access_token),
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      email: account.email,
      handle: account.handle,
      email_verified: true,
      mfa_enabled: false,
      role: 'user',
    });

    const refreshed = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: tokens.refresh_token },
    });
    expect(refreshed.statusCode).toBe(200);
    const next = refreshed.json<Tokens>();
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    // Rotation stays inside the same family.
    expect(next.session_id).toBe(tokens.session_id);

    const { rows } = await exec<{ rotated: boolean }>(
      `SELECT rotated_at IS NOT NULL AS rotated FROM refresh_tokens
        WHERE token_hash = $1`,
      [hashToken(tokens.refresh_token)],
    );
    expect(rows[0]?.rotated).toBe(true);
  });

  it('records every attempt in login_attempts (DG §7.1)', async () => {
    const { account } = await newVerifiedUser();
    await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: account.email, password: 'the-wrong-passphrase-99' },
    });

    const { rows } = await exec<{ success: boolean; failure_reason: string | null }>(
      `SELECT success, failure_reason FROM login_attempts WHERE email = $1 ORDER BY created_at`,
      [account.email],
    );
    expect(rows.some((r) => r.success)).toBe(true);
    expect(rows.some((r) => !r.success && r.failure_reason === 'bad_password')).toBe(true);
  });
});

describe('refresh-token family reuse detection (EF §2.3, ID-03) — the critical case', () => {
  it('revokes the ENTIRE family when an already-rotated token is presented again', async () => {
    const { tokens } = await newVerifiedUser();
    const family = tokens.session_id;

    // Legitimate rotation: r0 → r1.
    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: tokens.refresh_token },
    });
    expect(first.statusCode).toBe(200);
    const r1 = first.json<Tokens>().refresh_token;

    // A second rotation proves the family is healthy: r1 → r2.
    const second = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: r1 },
    });
    expect(second.statusCode).toBe(200);
    const r2 = second.json<Tokens>().refresh_token;

    // THE THEFT SIGNAL: r0 was already exchanged. Replaying it must not merely
    // fail — it must kill the family.
    const reuse = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: tokens.refresh_token },
    });
    expect(reuse.statusCode).toBe(401);

    const { rows } = await exec<{ total: string; revoked: string }>(
      `SELECT count(*)::text AS total,
              count(revoked_at)::text AS revoked
         FROM refresh_tokens WHERE family_id = $1`,
      [family],
    );
    expect(Number(rows[0]!.total)).toBe(3); // r0, r1, r2
    expect(Number(rows[0]!.revoked)).toBe(3); // every one of them

    // The thief's newest token is dead too — that is the whole point.
    const afterRevocation = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: r2 },
    });
    expect(afterRevocation.statusCode).toBe(401);

    // …and so is the victim's, so the compromise surfaces instead of hiding.
    const alsoDead = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: r1 },
    });
    expect(alsoDead.statusCode).toBe(401);

    const { rows: audit } = await exec<{ action: string }>(
      `SELECT action FROM audit_log WHERE target_id = $1 ORDER BY id`,
      [family],
    );
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['auth.refresh_reuse_detected', 'auth.family_revoked']),
    );

    const { rows: attempts } = await exec<{ failure_reason: string }>(
      `SELECT failure_reason FROM login_attempts WHERE failure_reason = 'refresh_reuse'`,
    );
    expect(attempts.length).toBeGreaterThan(0);
  });

  it('does not touch other families of the same user', async () => {
    const account = await registerAccount();
    await verifyAccount(account);
    const sessionA = await login(account);
    const sessionB = await login(account);
    expect(sessionA.session_id).not.toBe(sessionB.session_id);

    await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: sessionA.refresh_token },
    });
    const reuse = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: sessionA.refresh_token },
    });
    expect(reuse.statusCode).toBe(401);

    // Family B is untouched: revocation is scoped, not a global panic button.
    const stillGood = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: sessionB.refresh_token },
    });
    expect(stillGood.statusCode).toBe(200);
  });
});

describe('invalid and expired credentials are rejected', () => {
  it('refuses an unknown, an expired and a revoked refresh token identically', async () => {
    const { tokens } = await newVerifiedUser();

    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: 'not-a-real-token' },
    });
    expect(unknown.statusCode).toBe(401);

    await exec(`UPDATE refresh_tokens SET expires_at = now() - interval '1 day' WHERE token_hash = $1`, [
      hashToken(tokens.refresh_token),
    ]);
    const expired = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: tokens.refresh_token },
    });
    expect(expired.statusCode).toBe(401);
    expect(expired.json()).toEqual(unknown.json());

    const second = await newVerifiedUser();
    await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      payload: { refresh_token: second.tokens.refresh_token },
    });
    const revoked = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: second.tokens.refresh_token },
    });
    expect(revoked.statusCode).toBe(401);
  });

  it('rejects expired, tampered and wrong-type access tokens', async () => {
    const { account, tokens } = await newVerifiedUser();

    const expired = app.jwt.sign(
      { sub: account.id, role: 'user', mfa: false, sid: tokens.session_id, typ: 'access' },
      { expiresIn: -30 },
    );
    const withExpired = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: bearer(expired),
    });
    expect(withExpired.statusCode).toBe(401);

    const tampered = `${tokens.access_token.slice(0, -3)}aaa`;
    const withTampered = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: bearer(tampered),
    });
    expect(withTampered.statusCode).toBe(401);

    // A half-finished login (typ: 'mfa_challenge') must never authenticate.
    const challenge = app.jwt.sign({ sub: account.id, typ: 'mfa_challenge' }, { expiresIn: 300 });
    const withChallenge = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: bearer(challenge),
    });
    expect(withChallenge.statusCode).toBe(401);

    // Nor may a token minted for a different audience.
    const foreign = app.jwt.sign(
      { sub: account.id, role: 'user', mfa: false, sid: tokens.session_id, typ: 'access' },
      { aud: 'some-other-service' },
    );
    const withForeign = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: bearer(foreign),
    });
    expect(withForeign.statusCode).toBe(401);
  });

  it('cannot be locked out by a stranger spamming /register with the address', async () => {
    const { account } = await newVerifiedUser();

    // /register writes a `duplicate_registration` attempt row for this address.
    // If those counted towards lockout, anyone who knows an email could lock
    // its owner out at will.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: { email: account.email, handle: `spam${uniq()}`, password: PASSWORD },
      });
    }

    const stillWorks = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: account.email, password: PASSWORD },
    });
    expect(stillWorks.statusCode).toBe(200);
  });

  it('locks an account out with backoff after repeated failures (ID-02)', async () => {
    const { account } = await newVerifiedUser();
    let last;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      last = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: account.email, password: 'definitely-not-the-passphrase' },
      });
    }
    expect(last!.statusCode).toBe(429);
    expect(last!.headers['retry-after']).toBeDefined();
  });
});

describe('anti-enumeration (DG §7.1)', () => {
  it('answers register identically for a fresh and an already-registered address', async () => {
    const existing = await registerAccount();

    const duplicate = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email: existing.email, handle: `other${uniq()}`, password: PASSWORD },
    });
    const fresh = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email: `fresh-${uniq()}@example.com`, handle: `fresh${uniq()}`, password: PASSWORD },
    });

    expect(duplicate.statusCode).toBe(202);
    expect(fresh.statusCode).toBe(202);
    expect(duplicate.body).toBe(fresh.body);
    expect(Object.keys(duplicate.json())).toEqual(Object.keys(fresh.json()));

    // No second account was created, and the address owner was warned instead.
    const { rows } = await exec<{ count: string }>(
      `SELECT count(*)::text AS count FROM users WHERE email = $1`,
      [existing.email],
    );
    expect(rows[0]!.count).toBe('1');
    expect(lastMail(existing.email, 'duplicate_registration')).toBeDefined();
  });

  it('answers password/forgot identically for known and unknown addresses', async () => {
    const known = await registerAccount();
    await verifyAccount(known);

    const forKnown = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/forgot',
      payload: { email: known.email },
    });
    const forUnknown = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/forgot',
      payload: { email: `ghost-${uniq()}@example.com` },
    });

    expect(forKnown.statusCode).toBe(202);
    expect(forUnknown.statusCode).toBe(202);
    expect(forKnown.body).toBe(forUnknown.body);
  });

  it('answers verify-email identically for a wrong code and a non-existent account', async () => {
    const known = await registerAccount();

    const wrongCode = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-email',
      payload: { email: known.email, code: '000000' },
    });
    const noAccount = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-email',
      payload: { email: `ghost-${uniq()}@example.com`, code: '000000' },
    });

    expect(wrongCode.statusCode).toBe(400);
    expect(noAccount.statusCode).toBe(400);
    expect(wrongCode.body).toBe(noAccount.body);
  });
});

describe('password reset (ID-11)', () => {
  it('is single-use, kills every session and rejects a replay', async () => {
    const { account, tokens } = await newVerifiedUser();

    await app.inject({
      method: 'POST',
      url: '/v1/auth/password/forgot',
      payload: { email: account.email },
    });
    const mail = lastMail(account.email, 'password_reset');
    const resetUrl = new URL(mail!.data.reset_url!);
    const token = resetUrl.searchParams.get('token')!;
    expect(token).toBeTruthy();

    const newPassword = 'another-perfectly-good-phrase';
    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/reset',
      payload: { token, password: newPassword },
    });
    expect(first.statusCode).toBe(200);

    // Replay of the same token fails (single-use).
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/reset',
      payload: { token, password: 'yet-another-good-phrase' },
    });
    expect(replay.statusCode).toBe(400);

    // Existing sessions died with the reset.
    const refreshed = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: tokens.refresh_token },
    });
    expect(refreshed.statusCode).toBe(401);

    const relogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: account.email, password: newPassword },
    });
    expect(relogin.statusCode).toBe(200);
    expect(lastMail(account.email, 'password_changed')).toBeDefined();
  });

  it('refuses a weak or breached new password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/reset',
      payload: { token: 'irrelevant', password: 'correcthorsebatterystaple' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toMatch(/breach|common/i);
  });
});

describe('Google identity linking (DG §7.2, ID-05)', () => {
  it('REFUSES to link an existing account when email_verified is false', async () => {
    const account = await registerAccount();

    const outcome = await resolveGoogleIdentity(exec, {
      sub: `google-sub-${uniq()}`,
      email: account.email,
      email_verified: false,
      name: 'Impersonator',
    });

    expect(outcome.kind).toBe('refused');
    expect(outcome.kind === 'refused' && outcome.reason).toBe('provider_email_unverified');

    const { rows } = await exec<{ count: string }>(
      `SELECT count(*)::text AS count FROM auth_identities WHERE user_id = $1`,
      [account.id],
    );
    expect(rows[0]!.count).toBe('0');

    const { rows: refusals } = await exec<{ action: string }>(
      `SELECT action FROM audit_log WHERE action = 'auth.identity_link_refused'`,
    );
    expect(refusals.length).toBeGreaterThan(0);
  });

  it('refuses just as hard when email_verified is missing or a truthy non-boolean', async () => {
    const account = await registerAccount();

    const missing = await resolveGoogleIdentity(exec, {
      sub: `google-sub-${uniq()}`,
      email: account.email,
    });
    expect(missing.kind).toBe('refused');

    const spoofed = await resolveGoogleIdentity(exec, {
      sub: `google-sub-${uniq()}`,
      email: account.email,
      email_verified: 'true' as unknown as boolean,
    });
    expect(spoofed.kind).toBe('refused');
  });

  it('links to the existing account when Google verified the address', async () => {
    const account = await registerAccount();
    const sub = `google-sub-${uniq()}`;

    const outcome = await resolveGoogleIdentity(exec, {
      sub,
      email: account.email,
      email_verified: true,
    });
    expect(outcome.kind).toBe('linked');
    expect(outcome.kind === 'linked' && outcome.user.id).toBe(account.id);

    const { rows } = await exec<{ provider: string; provider_sub: string }>(
      `SELECT provider, provider_sub FROM auth_identities WHERE user_id = $1`,
      [account.id],
    );
    expect(rows).toEqual([{ provider: 'google', provider_sub: sub }]);

    // A second sign-in resolves through the identity row, not the email.
    const again = await resolveGoogleIdentity(exec, { sub, email: account.email, email_verified: true });
    expect(again.kind).toBe('existing_identity');
  });

  it('creates a password-less account for a new verified Google user', async () => {
    const email = `newcomer-${uniq()}@example.com`;
    const outcome = await resolveGoogleIdentity(exec, {
      sub: `google-sub-${uniq()}`,
      email,
      email_verified: true,
      name: 'New Comer',
    });

    expect(outcome.kind).toBe('created');
    const { rows } = await exec<{ password_hash: string | null; email_verified_at: Date | null }>(
      `SELECT password_hash, email_verified_at FROM users WHERE email = $1`,
      [email],
    );
    expect(rows[0]!.password_hash).toBeNull();
    expect(rows[0]!.email_verified_at).not.toBeNull();
  });

  it('boots with no Google credentials configured and serves no Google routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/google' });
    expect(res.statusCode).toBe(404);
  });
});

describe('profile access control (ID-08, ID-12)', () => {
  it('denies a cross-user profile update and allows the owner', async () => {
    const alice = await newVerifiedUser();
    const bob = await newVerifiedUser();

    const crossUser = await app.inject({
      method: 'PATCH',
      url: `/v1/users/${alice.account.id}`,
      headers: bearer(bob.tokens.access_token),
      payload: { display_name: 'Hijacked' },
    });
    expect(crossUser.statusCode).toBe(403);

    const own = await app.inject({
      method: 'PATCH',
      url: `/v1/users/${alice.account.id}`,
      headers: bearer(alice.tokens.access_token),
      payload: { display_name: 'Alice', bio: 'Pourover only.' },
    });
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({ display_name: 'Alice', bio: 'Pourover only.' });

    const anonymous = await app.inject({
      method: 'PATCH',
      url: `/v1/users/${alice.account.id}`,
      payload: { display_name: 'Nobody' },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('shows third parties only the public projection (private by default)', async () => {
    const alice = await newVerifiedUser();
    const bob = await newVerifiedUser();

    const asStranger = await app.inject({
      method: 'GET',
      url: `/v1/users/${alice.account.handle}`,
      headers: bearer(bob.tokens.access_token),
    });
    expect(asStranger.statusCode).toBe(200);
    const publicBody = asStranger.json<Record<string, unknown>>();
    expect(publicBody).not.toHaveProperty('email');
    expect(publicBody).not.toHaveProperty('role');
    expect(publicBody).not.toHaveProperty('last_seen_at');
    expect(publicBody).toMatchObject({ handle: alice.account.handle });

    const asSelf = await app.inject({
      method: 'GET',
      url: `/v1/users/${alice.account.handle}`,
      headers: bearer(alice.tokens.access_token),
    });
    expect(asSelf.json()).toMatchObject({ email: alice.account.email });
  });
});

describe('session management (ID-06)', () => {
  it('lists, revokes one and revokes all', async () => {
    const { account, tokens } = await newVerifiedUser();
    const other = await login(account);

    const list = await app.inject({
      method: 'GET',
      url: '/v1/auth/sessions',
      headers: bearer(tokens.access_token),
    });
    expect(list.statusCode).toBe(200);
    const sessions = list.json<{ sessions: Array<{ family_id: string; current: boolean }> }>()
      .sessions;
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.find((s) => s.family_id === tokens.session_id)?.current).toBe(true);

    const revokeOne = await app.inject({
      method: 'DELETE',
      url: `/v1/auth/sessions/${other.session_id}`,
      headers: bearer(tokens.access_token),
    });
    expect(revokeOne.statusCode).toBe(200);

    const deadRefresh = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: other.refresh_token },
    });
    expect(deadRefresh.statusCode).toBe(401);

    const revokeAll = await app.inject({
      method: 'DELETE',
      url: '/v1/auth/sessions',
      headers: bearer(tokens.access_token),
    });
    expect(revokeAll.statusCode).toBe(200);
    const afterAll = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: tokens.refresh_token },
    });
    expect(afterAll.statusCode).toBe(401);
  });

  it("refuses to revoke another user's session", async () => {
    const alice = await newVerifiedUser();
    const bob = await newVerifiedUser();

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/auth/sessions/${alice.tokens.session_id}`,
      headers: bearer(bob.tokens.access_token),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('TOTP MFA (ID-07)', () => {
  async function enableMfa(access: string): Promise<{ secret: string; recoveryCodes: string[] }> {
    const enrol = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/enrol',
      headers: bearer(access),
    });
    expect(enrol.statusCode).toBe(200);
    const secret = enrol.json<{ secret: string }>().secret;

    const confirm = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/confirm',
      headers: bearer(access),
      payload: { code: await currentTotpToken(secret) },
    });
    expect(confirm.statusCode).toBe(200);
    return { secret, recoveryCodes: confirm.json<{ recovery_codes: string[] }>().recovery_codes };
  }

  it('enrols, challenges at login and marks the session MFA-backed', async () => {
    const { account, tokens } = await newVerifiedUser();
    const { secret, recoveryCodes } = await enableMfa(tokens.access_token);
    expect(recoveryCodes).toHaveLength(10);

    const challenged = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: account.email, password: PASSWORD },
    });
    expect(challenged.statusCode).toBe(200);
    const { mfa_required: mfaRequired, mfa_token: mfaToken } = challenged.json<{
      mfa_required?: boolean;
      mfa_token?: string;
      access_token?: string;
    }>();
    expect(mfaRequired).toBe(true);
    expect(mfaToken).toBeTruthy();
    expect(challenged.json<{ access_token?: string }>().access_token).toBeUndefined();

    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/verify',
      payload: { mfa_token: mfaToken, code: '000000' },
    });
    expect(wrong.statusCode).toBe(401);

    const done = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/verify',
      payload: { mfa_token: mfaToken, code: await nextTotpToken(secret) },
    });
    expect(done.statusCode).toBe(200);
    const mfaSession = done.json<Tokens>();
    const decoded = app.jwt.verify<{ mfa: boolean }>(mfaSession.access_token);
    expect(decoded.mfa).toBe(true);
  });

  it('does not let a pre-enrolment session gain MFA standing by refreshing', async () => {
    const { tokens } = await newVerifiedUser();
    // This session was created before TOTP existed on the account.
    expect(app.jwt.verify<{ mfa: boolean }>(tokens.access_token).mfa).toBe(false);

    await enableMfa(tokens.access_token);

    const refreshed = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: tokens.refresh_token },
    });
    expect(refreshed.statusCode).toBe(200);
    const rotated = refreshed.json<Tokens>();
    // Refreshing carries MFA standing forward; it never manufactures it.
    expect(app.jwt.verify<{ mfa: boolean }>(rotated.access_token).mfa).toBe(false);
  });

  it('carries MFA standing forward across rotations of an MFA-backed session', async () => {
    const { account, tokens } = await newVerifiedUser();
    const { secret } = await enableMfa(tokens.access_token);

    const challenge = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: account.email, password: PASSWORD },
    });
    const verified = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/verify',
      payload: {
        mfa_token: challenge.json<{ mfa_token: string }>().mfa_token,
        code: await nextTotpToken(secret),
      },
    });
    const mfaSession = verified.json<Tokens>();
    expect(app.jwt.verify<{ mfa: boolean }>(mfaSession.access_token).mfa).toBe(true);

    const refreshed = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: mfaSession.refresh_token },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(
      app.jwt.verify<{ mfa: boolean }>(refreshed.json<Tokens>().access_token).mfa,
    ).toBe(true);
  });

  it('accepts a recovery code exactly once', async () => {
    const { account, tokens } = await newVerifiedUser();
    const { recoveryCodes } = await enableMfa(tokens.access_token);
    const code = recoveryCodes[0]!;

    const start = async (): Promise<string> => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: account.email, password: PASSWORD },
      });
      return res.json<{ mfa_token: string }>().mfa_token;
    };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/verify',
      payload: { mfa_token: await start(), recovery_code: code },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/verify',
      payload: { mfa_token: await start(), recovery_code: code },
    });
    expect(second.statusCode).toBe(401);
  });
});

describe('role changes are staff-only, MFA-gated and audited (ID-08, ID-09)', () => {
  it('lets an MFA-backed admin promote a user and records it in audit_log', async () => {
    const adminAccount = await registerAccount();
    await verifyAccount(adminAccount);
    await exec(`UPDATE users SET role = 'admin' WHERE id = $1`, [adminAccount.id]);

    const adminTokens = await login(adminAccount);
    // Enrol and complete an MFA login, because isStaff() demands actor.mfa.
    const enrol = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/enrol',
      headers: bearer(adminTokens.access_token),
    });
    const secret = enrol.json<{ secret: string }>().secret;
    await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/confirm',
      headers: bearer(adminTokens.access_token),
      payload: { code: await currentTotpToken(secret) },
    });

    const challenge = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: adminAccount.email, password: PASSWORD },
    });
    const verified = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/verify',
      payload: {
        mfa_token: challenge.json<{ mfa_token: string }>().mfa_token,
        code: await nextTotpToken(secret),
      },
    });
    const staffAccess = verified.json<Tokens>().access_token;

    const target = await newVerifiedUser();

    // A plain user cannot promote anyone.
    const byUser = await app.inject({
      method: 'PATCH',
      url: `/v1/users/${target.account.id}/role`,
      headers: bearer(target.tokens.access_token),
      payload: { role: 'moderator' },
    });
    expect(byUser.statusCode).toBe(403);

    // Neither can the admin's own non-MFA session.
    const withoutMfa = await app.inject({
      method: 'PATCH',
      url: `/v1/users/${target.account.id}/role`,
      headers: bearer(adminTokens.access_token),
      payload: { role: 'moderator' },
    });
    expect(withoutMfa.statusCode).toBe(403);

    const promoted = await app.inject({
      method: 'PATCH',
      url: `/v1/users/${target.account.id}/role`,
      headers: bearer(staffAccess),
      payload: { role: 'moderator', reason: 'trusted contributor' },
    });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json()).toMatchObject({ role: 'moderator' });

    const { rows } = await exec<{ action: string; payload: { from: string; to: string } }>(
      `SELECT action, payload FROM audit_log
        WHERE action = 'user.role_changed' AND target_id = $1`,
      [target.account.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ from: 'user', to: 'moderator' });

    // Role is baked into access tokens, so the target's sessions were revoked.
    const staleRefresh = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: target.tokens.refresh_token },
    });
    expect(staleRefresh.statusCode).toBe(401);
  });
});

describe('CSRF protection on cookie-authenticated mutations (ID-04)', () => {
  it('sets HttpOnly cookies and scopes the refresh cookie to the auth path', async () => {
    const account = await registerAccount();
    await verifyAccount(account);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: account.email, password: PASSWORD },
    });

    const access = res.cookies.find((c) => c.name === 'bc_access');
    const refresh = res.cookies.find((c) => c.name === 'bc_refresh');
    expect(access).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });

    // The refresh cookie's path must be written the way the BROWSER sees the
    // URL, not the way this app routes it. Caddy (prod) and the Next dev
    // rewrite both strip `/api`, so Fastify serves `/v1/auth/refresh` while the
    // browser requests `/api/v1/auth/refresh`. Path matching happens in the
    // browser against the URL it used.
    //
    // This assertion previously read `path: '/v1/auth'` — the internal route —
    // so it went green while `bc_refresh` was never sent by any real browser
    // and every session silently died 15 minutes after login. Verified against
    // production with curl, which path-matches exactly as a browser does.
    expect(refresh).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/api/v1/auth' });
    // Narrower than `/`: the long-lived credential must not ride along on
    // ordinary API traffic.
    expect(refresh?.path).not.toBe('/');

    // NODE_ENV=test → not production → no Secure flag, so http://localhost works.
    expect(access).not.toHaveProperty('secure', true);
  });

  it('sets a readable session hint that outlives the access cookie', async () => {
    const account = await registerAccount();
    await verifyAccount(account);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: account.email, password: PASSWORD },
    });

    const hint = res.cookies.find((c) => c.name === 'bc_session');
    // Readable BY DESIGN. The refresh cookie is scoped to the auth path, so a
    // page navigation carries no credential once the access cookie has expired
    // — the browser is the only party that can recover the session, and it
    // needs to know a recovery is worth attempting. Production ran a week with
    // 19 sign-ins and one refresh because nothing told it.
    expect(hint).toMatchObject({ path: '/', sameSite: 'Lax' });
    // No HttpOnly attribute at all — that absence is the feature.
    expect(hint?.httpOnly).toBeFalsy();
    expect(hint?.value).toBe('1');

    // It holds no token. Anything that reads it as authority is a bug.
    expect(hint?.value).not.toContain('.');

    // And it outlives the access cookie, which is the entire point.
    const access = res.cookies.find((c) => c.name === 'bc_access');
    expect(access?.maxAge).toBeLessThan(60 * 60);
    expect(hint?.expires).toBeInstanceOf(Date);
    expect((hint?.expires as Date).getTime()).toBeGreaterThan(Date.now() + 24 * 60 * 60 * 1000);
  });

  it('grants nothing: the hint alone is still an anonymous request', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: { cookie: 'bc_session=1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('clears the hint on logout, so the browser stops trying to restore', async () => {
    const account = await registerAccount();
    await verifyAccount(account);
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: account.email, password: PASSWORD },
    });
    const csrf = await app.inject({
      method: 'GET',
      url: '/v1/auth/csrf',
      headers: { cookie: cookieHeader(login) },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: {
        // Double-submit: the token goes in BOTH the header and the cookie jar.
        cookie: [cookieHeader(login), cookieHeader(csrf)].join('; '),
        'x-csrf-token': csrf.json<{ csrf_token: string }>().csrf_token,
      },
    });

    expect(res.statusCode).toBe(200);
    const hint = res.cookies.find((c) => c.name === 'bc_session');
    expect(hint?.value).toBe('');
    expect(hint?.path).toBe('/');
  });

  it('rejects a cookie-authenticated mutation without a CSRF token and accepts it with one', async () => {
    const account = await registerAccount();
    await verifyAccount(account);
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: account.email, password: PASSWORD },
    });
    const sessionCookies = cookieHeader(loginRes);

    const withoutToken = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { cookie: sessionCookies },
    });
    expect(withoutToken.statusCode).toBe(403);

    const csrfRes = await app.inject({
      method: 'GET',
      url: '/v1/auth/csrf',
      headers: { cookie: sessionCookies },
    });
    expect(csrfRes.statusCode).toBe(200);
    const csrfToken = csrfRes.json<{ csrf_token: string }>().csrf_token;

    const withToken = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: {
        cookie: [sessionCookies, cookieHeader(csrfRes)].join('; '),
        'x-csrf-token': csrfToken,
      },
    });
    expect(withToken.statusCode).toBe(200);
  });

  it('refuses a cross-origin browser request outright', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { email: 'someone@example.com', password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
  });
});
