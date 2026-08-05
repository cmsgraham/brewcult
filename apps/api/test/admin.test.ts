/**
 * Admin / operations module — integration suite (EF §1.4: "each module's API +
 * DB, no mocks of SQL").
 *
 * The database is a real PostgreSQL 16 engine (PGlite, the WASM build) with
 * db/migrations/0001..0007 applied VERBATIM apart from the extensions PGlite
 * does not ship — `vector` (0001) and `pg_trgm` (0004, with the trigram indexes
 * that need it). Everything this lane depends on is the real thing: the
 * `users.status`/`users.role` CHECK constraints, the append-only `audit_log`
 * trigger, the partial unique index that stops duplicate open reports, and the
 * review-consistency CHECKs of 0007.
 *
 * `lib/db` is the only mocked seam — `query`/`transaction` are re-pointed at
 * the in-process database, exactly as the identity suite does. That matters
 * enormously here: it means IDENTITY'S OWN HTTP ROUTES run in this harness too,
 * so the tests below drive REAL registration, REAL email verification, REAL
 * TOTP enrolment and REAL logins. Staff sessions in this file are staff
 * sessions because the actor cleared an MFA challenge — not because a test hook
 * asserted `{ role: 'admin', mfa: true }`. That is the difference between
 * testing the MFA gate and testing a fixture.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

const holder = vi.hoisted(() => {
  // Must be in place before `lib/env.ts` memoises the environment.
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'admin-lane-test-secret-at-least-32-characters';
  process.env.APP_URL = 'http://localhost:3000';
  process.env.API_URL = 'http://localhost:4000';
  // The ADMIN_EMAILS bootstrap is installed for the whole run, so the hook is
  // exercised in situ against identity's real login/verify-email routes.
  process.env.ADMIN_EMAILS = 'founder@brewcult.test, ghost@brewcult.test';
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
const { registerIdentityRoutes, setIdentityMailer } = await import(
  '../src/modules/identity/index.js'
);
const { currentTotpToken } = await import('../src/modules/identity/mfa.js');
// The seam under test: identity's REAL revoke-all, injected the way `app.ts`
// will inject it once identity re-exports it from its public interface.
const { revokeAllFamiliesForUser } = await import('../src/modules/identity/tokens.js');
const {
  registerAdminRoutes,
  grantRoleByEmail,
  parseAdminEmails,
  promoteAllowlistedAdmin,
  countActiveAdmins,
  defaultAdminDb,
  listStaff,
  setSessionRevoker,
} = await import('../src/modules/admin/index.js');
import type { IdentityMailMessage } from '../src/modules/identity/mailer.js';
import type {
  AdminUserDetail,
  AdminUserRow,
  AuditLogEntry,
  Report,
  SellerApplication,
} from '../src/modules/admin/index.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const MIGRATIONS = [
  'db/migrations/0001_extensions.sql',
  'db/migrations/0002_identity.sql',
  'db/migrations/0003_catalog.sql',
  'db/migrations/0004_catalog_search_indexes.sql',
  'db/migrations/0005_identity_extras.sql',
  'db/migrations/0006_brewing.sql',
  'db/migrations/0007_admin.sql',
];

let app: FastifyInstance;
const mails: IdentityMailMessage[] = [];

const exec = <T = Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<{ rows: T[] }> =>
  holder.db!.query(text, params as unknown[]) as unknown as Promise<{ rows: T[] }>;

const PASSWORD = 'a-long-enough-passphrase-42';
let seq = 0;
const uniq = (): string => `${Date.now().toString(36)}${(seq += 1)}`;

interface Account {
  id: string;
  email: string;
  handle: string;
  /** Bearer access token of a live session. */
  token: string;
  /** TOTP secret when MFA was enrolled. */
  secret?: string;
}

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

const lastMail = (to: string, template: string): IdentityMailMessage | undefined =>
  [...mails].reverse().find((m) => m.to === to && m.template === template);

/** A code from the NEXT 30-second step — replay protection blocks re-use. */
const nextTotpToken = (secret: string): Promise<string> =>
  currentTotpToken(secret, Math.floor(Date.now() / 1000) + 30);

async function registerAndVerify(email?: string): Promise<{ id: string; email: string; handle: string }> {
  const tag = uniq();
  const address = email ?? `brewer-${tag}@example.com`;
  const handle = `brewer${tag}`;

  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { email: address, handle, password: PASSWORD },
  });
  expect(res.statusCode).toBe(202);

  const mail = lastMail(address, 'verify_email');
  expect(mail).toBeDefined();
  const verified = await app.inject({
    method: 'POST',
    url: '/v1/auth/verify-email',
    payload: { email: address, code: mail!.data.code },
  });
  expect(verified.statusCode).toBe(200);

  const { rows } = await exec<{ id: string }>('SELECT id::text AS id FROM users WHERE email = $1', [
    address,
  ]);
  return { id: rows[0]!.id, email: address, handle };
}

async function plainLogin(email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email, password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ access_token: string }>().access_token;
}

/** Enrols TOTP on a live session and returns the secret. */
async function enrolMfa(token: string): Promise<string> {
  const enrol = await app.inject({
    method: 'POST',
    url: '/v1/auth/mfa/enrol',
    headers: bearer(token),
    payload: {},
  });
  expect(enrol.statusCode).toBe(200);
  const secret = enrol.json<{ secret: string }>().secret;

  const confirm = await app.inject({
    method: 'POST',
    url: '/v1/auth/mfa/confirm',
    headers: bearer(token),
    payload: { code: await currentTotpToken(secret) },
  });
  expect(confirm.statusCode).toBe(200);
  return secret;
}

/** Full two-leg login: password, then the TOTP challenge. Yields `mfa: true`. */
async function mfaLogin(email: string, secret: string): Promise<string> {
  const challenge = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email, password: PASSWORD },
  });
  expect(challenge.statusCode).toBe(200);
  const mfaToken = challenge.json<{ mfa_required?: boolean; mfa_token?: string }>().mfa_token;
  expect(mfaToken).toBeTruthy();

  const verified = await app.inject({
    method: 'POST',
    url: '/v1/auth/mfa/verify',
    payload: { mfa_token: mfaToken, code: await nextTotpToken(secret) },
  });
  expect(verified.statusCode).toBe(200);
  return verified.json<{ access_token: string }>().access_token;
}

const setRole = (id: string, role: string): Promise<unknown> =>
  exec('UPDATE users SET role = $2 WHERE id = $1::uuid', [id, role]);

/**
 * Builds an account holding `role` on an MFA-backed session — i.e. an actor
 * `isStaff()` actually accepts. The role is set in the database BEFORE the
 * final login so the access token carries it, which is how the real system
 * works: the claim comes from the row at issuance time.
 */
async function staffAccount(role: string, email?: string): Promise<Account> {
  const base = await registerAndVerify(email);
  const first = await plainLogin(base.email);
  const secret = await enrolMfa(first);
  await setRole(base.id, role);
  const token = await mfaLogin(base.email, secret);
  return { ...base, token, secret };
}

/** An ordinary, non-staff account with a live session. */
async function userAccount(email?: string): Promise<Account> {
  const base = await registerAndVerify(email);
  return { ...base, token: await plainLogin(base.email) };
}

// Fixtures shared by the whole file.
let admin: Account;
let admin2: Account;
let moderator: Account;
/** Holds the `admin` ROLE but signed in without MFA — the crucial 403 case. */
let adminNoMfa: Account;
let plain: Account;

beforeAll(async () => {
  holder.db = await PGlite.create({ extensions: { citext, pgcrypto } });

  for (const file of MIGRATIONS) {
    const sql = (await readFile(repoRoot + file, 'utf8'))
      .replace(/CREATE EXTENSION IF NOT EXISTS vector;/g, '-- vector: unavailable in PGlite')
      .replace(/CREATE EXTENSION IF NOT EXISTS pg_trgm;/g, '-- pg_trgm: unavailable in PGlite')
      .replace(
        /CREATE INDEX IF NOT EXISTS \w+\n\s+ON \w+ USING gin \(lower\(name\) gin_trgm_ops\);/g,
        '-- trigram index: needs pg_trgm',
      );
    await holder.db.exec(sql);
  }

  setIdentityMailer(async (message) => {
    mails.push(message);
  });

  app = Fastify({ logger: false });
  registerErrorHandler(app);
  await registerIdentityRoutes(app);
  // THE SEAM: identity's real `revokeAllFamiliesForUser`, injected exactly the
  // way `app.ts` will inject it. Nothing about revocation is stubbed.
  await registerAdminRoutes(app, { revokeSessions: revokeAllFamiliesForUser });
  await app.ready();

  admin = await staffAccount('admin');
  admin2 = await staffAccount('admin');
  moderator = await staffAccount('moderator');
  adminNoMfa = await userAccount();
  await setRole(adminNoMfa.id, 'admin');
  adminNoMfa.token = await plainLogin(adminNoMfa.email); // role admin, mfa false
  plain = await userAccount();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await holder.db?.close();
  setIdentityMailer(null);
});

// ===========================================================================
describe('harness', () => {
  it('applies 0007 with the tables and the partial unique indexes', async () => {
    const tables = await exec<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining(['admin_seller_applications', 'reports']),
    );

    const indexes = await exec<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const names = indexes.rows.map((r) => r.indexname);
    expect(names).toContain('uq_reports_live_per_reporter_target');
    expect(names).toContain('uq_seller_applications_pending_per_user');
  });

  it('produced genuinely MFA-backed staff sessions (not a fixture)', async () => {
    // If this ever regresses to a hand-rolled actor, every 403 test below
    // becomes vacuous — so assert the property directly.
    const res = await app.inject({ url: '/v1/admin/users?limit=1', headers: bearer(admin.token) });
    expect(res.statusCode).toBe(200);
    const noMfa = await app.inject({
      url: '/v1/admin/users?limit=1',
      headers: bearer(adminNoMfa.token),
    });
    expect(noMfa.statusCode).toBe(403);
  });
});

// ===========================================================================
describe('the staff gate — EF §3.2 "MFA enforced" on EVERY admin endpoint', () => {
  /** Every staff-gated route, with a body that PASSES schema validation. */
  const endpoints = (): Array<{
    method: 'GET' | 'POST' | 'PATCH';
    url: string;
    payload?: Record<string, unknown>;
  }> => [
    { method: 'GET', url: '/v1/admin/users' },
    { method: 'GET', url: `/v1/admin/users/${plain.id}` },
    { method: 'POST', url: `/v1/admin/users/${plain.id}/suspend`, payload: { reason: 'probe' } },
    { method: 'POST', url: `/v1/admin/users/${plain.id}/reactivate`, payload: {} },
    { method: 'PATCH', url: `/v1/admin/users/${plain.id}/role`, payload: { role: 'admin' } },
    { method: 'POST', url: `/v1/admin/users/${plain.id}/force-logout`, payload: {} },
    { method: 'GET', url: '/v1/admin/audit' },
    { method: 'GET', url: '/v1/admin/seller-applications' },
    {
      method: 'POST',
      url: `/v1/admin/seller-applications/${plain.id}/approve`,
      payload: {},
    },
    { method: 'POST', url: `/v1/admin/seller-applications/${plain.id}/reject`, payload: {} },
    { method: 'GET', url: '/v1/admin/reports' },
    { method: 'POST', url: `/v1/admin/reports/${plain.id}/claim`, payload: {} },
    {
      method: 'POST',
      url: `/v1/admin/reports/${plain.id}/resolve`,
      payload: { outcome: 'dismissed', resolution: 'probe' },
    },
  ];

  it('ANONYMOUS gets 401 everywhere', async () => {
    for (const ep of endpoints()) {
      const res = await app.inject({ method: ep.method, url: ep.url, payload: ep.payload });
      expect(`${ep.method} ${ep.url} → ${res.statusCode}`).toBe(`${ep.method} ${ep.url} → 401`);
    }
  });

  it('an ordinary USER gets 403 everywhere', async () => {
    for (const ep of endpoints()) {
      const res = await app.inject({
        method: ep.method,
        url: ep.url,
        payload: ep.payload,
        headers: bearer(plain.token),
      });
      expect(`${ep.method} ${ep.url} → ${res.statusCode}`).toBe(`${ep.method} ${ep.url} → 403`);
    }
  });

  it('an ADMIN WITHOUT MFA gets 403 everywhere — the role alone is not enough', async () => {
    for (const ep of endpoints()) {
      const res = await app.inject({
        method: ep.method,
        url: ep.url,
        payload: ep.payload,
        headers: bearer(adminNoMfa.token),
      });
      expect(`${ep.method} ${ep.url} → ${res.statusCode}`).toBe(`${ep.method} ${ep.url} → 403`);
    }
  });

  it('never leaks 404-vs-403 to a non-staff caller (no id oracle)', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    for (const token of [plain.token, adminNoMfa.token]) {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/admin/users/${missing}/suspend`,
        payload: { reason: 'probe' },
        headers: bearer(token),
      });
      // 403 for a non-existent id, exactly as for an existing one.
      expect(res.statusCode).toBe(403);
    }
  });

  it('the audit viewer NEVER returns rows to a non-staff actor', async () => {
    for (const token of [plain.token, adminNoMfa.token]) {
      const res = await app.inject({ url: '/v1/admin/audit', headers: bearer(token) });
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('items');
      expect(res.json<{ items?: unknown }>().items).toBeUndefined();
    }
    const anon = await app.inject({ url: '/v1/admin/audit' });
    expect(anon.statusCode).toBe(401);
  });
});

// ===========================================================================
describe('user list — filters, pagination, and the P2 projection', () => {
  it('returns the admin-shaped row, not the public profile', async () => {
    const res = await app.inject({
      url: `/v1/admin/users?q=${encodeURIComponent(plain.email)}`,
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: AdminUserRow[] }>().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: plain.id,
      email: plain.email,
      handle: plain.handle,
      role: 'user',
      status: 'active',
      mfa_enabled: false,
      has_password: true,
    });
    expect(items[0]!.email_verified_at).not.toBeNull();
    expect(items[0]!.auth_providers).toEqual([]);
    expect(typeof items[0]!.created_at).toBe('string');
  });

  it('filters by role and by status', async () => {
    const admins = await app.inject({
      url: '/v1/admin/users?role=admin&limit=100',
      headers: bearer(admin.token),
    });
    const ids = admins.json<{ items: AdminUserRow[] }>().items.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([admin.id, admin2.id, adminNoMfa.id]));
    expect(ids).not.toContain(plain.id);

    const suspended = await app.inject({
      url: '/v1/admin/users?status=suspended&limit=100',
      headers: bearer(admin.token),
    });
    expect(suspended.json<{ items: AdminUserRow[] }>().items).toHaveLength(0);
  });

  it('filters by an email/handle PREFIX and treats LIKE metacharacters literally', async () => {
    const byHandle = await app.inject({
      url: `/v1/admin/users?q=${plain.handle.slice(0, 8)}`,
      headers: bearer(admin.token),
    });
    expect(byHandle.json<{ items: AdminUserRow[] }>().items.length).toBeGreaterThan(0);

    // A bare `%` must not become "match everything".
    const wildcard = await app.inject({ url: '/v1/admin/users?q=%25', headers: bearer(admin.token) });
    expect(wildcard.statusCode).toBe(200);
    expect(wildcard.json<{ items: AdminUserRow[] }>().items).toHaveLength(0);
  });

  it('filters by a created range', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const none = await app.inject({
      url: `/v1/admin/users?created_from=${encodeURIComponent(future)}`,
      headers: bearer(admin.token),
    });
    expect(none.json<{ items: AdminUserRow[] }>().items).toHaveLength(0);

    const all = await app.inject({
      url: `/v1/admin/users?created_to=${encodeURIComponent(future)}&limit=100`,
      headers: bearer(admin.token),
    });
    expect(all.json<{ items: AdminUserRow[] }>().items.length).toBeGreaterThan(3);
  });

  it('pages forward on an opaque keyset cursor and never repeats a row', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 50; guard += 1) {
      const url: string = `/v1/admin/users?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await app.inject({ url, headers: bearer(admin.token) });
      expect(page.statusCode).toBe(200);
      const body = page.json<{ items: AdminUserRow[]; next_cursor: string | null }>();
      seen.push(...body.items.map((u) => u.id));
      cursor = body.next_cursor;
      if (!cursor) break;
    }
    expect(seen.length).toBeGreaterThan(2);
    expect(new Set(seen).size).toBe(seen.length);

    const tampered = await app.inject({
      url: '/v1/admin/users?cursor=nonsense',
      headers: bearer(admin.token),
    });
    expect(tampered.statusCode).toBe(400);
  });

  it('detail carries login attempts, session counts and open reports', async () => {
    const res = await app.inject({
      url: `/v1/admin/users/${plain.id}`,
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(200);
    const detail = res.json<AdminUserDetail>();
    expect(detail.id).toBe(plain.id);
    expect(detail.recent_login_attempts.length).toBeGreaterThan(0);
    expect(detail.recent_login_attempts[0]!.success).toBe(true);
    expect(detail.sessions.total).toBeGreaterThan(0);
    expect(detail.sessions.active).toBeGreaterThan(0);
    expect(detail.open_reports).toBe(0);
  });

  it('404s an unknown id for a staff caller', async () => {
    const res = await app.inject({
      url: '/v1/admin/users/00000000-0000-4000-8000-000000000000',
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ===========================================================================
describe('suspension — status, session revocation, and the login door', () => {
  it('suspends, REVOKES every refresh family, and the user can no longer log in', async () => {
    const victim = await userAccount();

    const before = await exec<{ count: number }>(
      `SELECT count(*)::int AS count FROM refresh_tokens WHERE user_id = $1::uuid AND revoked_at IS NULL`,
      [victim.id],
    );
    expect(before.rows[0]!.count).toBeGreaterThan(0);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/admin/users/${victim.id}/suspend`,
      payload: { reason: 'spamming the grind-conversion table' },
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ sessions_revoked: number | null; previous_status: string }>();
    expect(body.previous_status).toBe('active');
    // Real revocation through identity's real helper — not null, not zero.
    expect(body.sessions_revoked).toBeGreaterThan(0);

    const after = await exec<{ status: string; live: number }>(
      `SELECT u.status,
              (SELECT count(*)::int FROM refresh_tokens r
                WHERE r.user_id = u.id AND r.revoked_at IS NULL) AS live
         FROM users u WHERE u.id = $1::uuid`,
      [victim.id],
    );
    expect(after.rows[0]!.status).toBe('suspended');
    expect(after.rows[0]!.live).toBe(0);

    // THE door that matters: identity's real login route now refuses them.
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: victim.email, password: PASSWORD },
    });
    expect(login.statusCode).toBe(401);

    // ...and their revoked refresh token cannot be traded for a new session.
    const refresh = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: {},
      headers: bearer(victim.token),
    });
    expect(refresh.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('writes an audit row naming the acting admin and the reason', async () => {
    const victim = await userAccount();
    await app.inject({
      method: 'POST',
      url: `/v1/admin/users/${victim.id}/suspend`,
      payload: { reason: 'ban evasion' },
      headers: bearer(admin.token),
    });

    const rows = await exec<{ actor_id: string; payload: Record<string, unknown> }>(
      `SELECT actor_id::text AS actor_id, payload FROM audit_log
        WHERE action = 'admin.user_suspended' AND target_id = $1`,
      [victim.id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.actor_id).toBe(admin.id);
    expect(rows.rows[0]!.payload).toMatchObject({
      reason: 'ban evasion',
      from_status: 'active',
      to_status: 'suspended',
    });
  });

  it('reactivates, and the account can sign in again', async () => {
    const victim = await userAccount();
    await app.inject({
      method: 'POST',
      url: `/v1/admin/users/${victim.id}/suspend`,
      payload: { reason: 'temporary' },
      headers: bearer(admin.token),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/admin/users/${victim.id}/reactivate`,
      payload: { reason: 'appeal upheld' },
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ previous_status: string }>().previous_status).toBe('suspended');

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: victim.email, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);

    const audited = await exec<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_log
        WHERE action = 'admin.user_reactivated' AND target_id = $1`,
      [victim.id],
    );
    expect(audited.rows[0]!.count).toBe(1);
  });

  it('a MODERATOR may suspend an ordinary user but NOT another staff member', async () => {
    const victim = await userAccount();
    const ok = await app.inject({
      method: 'POST',
      url: `/v1/admin/users/${victim.id}/suspend`,
      payload: { reason: 'moderator action' },
      headers: bearer(moderator.token),
    });
    expect(ok.statusCode).toBe(200);

    const nope = await app.inject({
      method: 'POST',
      url: `/v1/admin/users/${admin2.id}/suspend`,
      payload: { reason: 'coup' },
      headers: bearer(moderator.token),
    });
    expect(nope.statusCode).toBe(403);
  });

  it('force-logout revokes every session without changing status', async () => {
    const victim = await userAccount();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/admin/users/${victim.id}/force-logout`,
      payload: { reason: 'device lost' },
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ sessions_revoked: number }>().sessions_revoked).toBeGreaterThan(0);

    const row = await exec<{ status: string; live: number }>(
      `SELECT u.status,
              (SELECT count(*)::int FROM refresh_tokens r
                WHERE r.user_id = u.id AND r.revoked_at IS NULL) AS live
         FROM users u WHERE u.id = $1::uuid`,
      [victim.id],
    );
    expect(row.rows[0]!.status).toBe('active');
    expect(row.rows[0]!.live).toBe(0);

    // Still able to sign in — this is a logout, not a ban.
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: victim.email, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it('revokes sessions through the published identity revoker when suspending', async () => {
    // Wave 3.5 integration: identity now exports revokeAllFamiliesForUser, so
    // the module's auto-discovery resolves a real revoker and the previously
    // reachable "unwired seam" state no longer exists. The degraded path
    // (sessions_revoked: null) is retained as defensive code in sessions.ts for
    // the case where identity's interface changes underneath us.
    const victim = await userAccount();
    setSessionRevoker(revokeAllFamiliesForUser);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/admin/users/${victim.id}/suspend`,
      payload: { reason: 'revoker wired' },
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ sessions_revoked: number | null }>().sessions_revoked).not.toBeNull();

    const row = await exec<{ status: string }>('SELECT status FROM users WHERE id = $1::uuid', [
      victim.id,
    ]);
    // The suspension itself is never conditional on the seam.
    expect(row.rows[0]!.status).toBe('suspended');
  });
});

// ===========================================================================
describe('role changes — the guardrails', () => {
  it('REFUSES self-demotion with 409, and the role is unchanged', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${admin.id}/role`,
      payload: { role: 'user' },
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ message: string }>().message).toMatch(/your own role/i);

    const row = await exec<{ role: string }>('SELECT role FROM users WHERE id = $1::uuid', [
      admin.id,
    ]);
    expect(row.rows[0]!.role).toBe('admin');
  });

  it('REFUSES self-suspension with 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/admin/users/${admin.id}/suspend`,
      payload: { reason: 'oops' },
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ message: string }>().message).toMatch(/your own account/i);

    const row = await exec<{ status: string }>('SELECT status FROM users WHERE id = $1::uuid', [
      admin.id,
    ]);
    expect(row.rows[0]!.status).toBe('active');
  });

  it('REFUSES a change that would leave ZERO active admins', async () => {
    // Arrange the only situation in which the guard can actually fire: the
    // acting admin's own account is no longer ACTIVE (deactivated in another
    // tab, or by a concurrent operation) while their access token is still
    // inside its 15-minute TTL. `countActiveAdmins` excluding the target then
    // returns 0, because the actor no longer counts.
    const others = await exec<{ id: string }>(
      `SELECT id::text AS id FROM users WHERE role = 'admin' AND status = 'active' AND id <> $1::uuid AND id <> $2::uuid`,
      [admin.id, admin2.id],
    );
    for (const row of others.rows) await setRole(row.id, 'user');
    await exec(`UPDATE users SET status = 'deactivated' WHERE id = $1::uuid`, [admin.id]);

    try {
      expect(await countActiveAdmins(defaultAdminDb, admin2.id)).toBe(0);

      const demote = await app.inject({
        method: 'PATCH',
        url: `/v1/admin/users/${admin2.id}/role`,
        payload: { role: 'user' },
        headers: bearer(admin.token),
      });
      expect(demote.statusCode).toBe(409);
      expect(demote.json<{ message: string }>().message).toMatch(/last active admin/i);

      const suspend = await app.inject({
        method: 'POST',
        url: `/v1/admin/users/${admin2.id}/suspend`,
        payload: { reason: 'decapitation attempt' },
        headers: bearer(admin.token),
      });
      expect(suspend.statusCode).toBe(409);
      expect(suspend.json<{ message: string }>().message).toMatch(/last active admin/i);

      const row = await exec<{ role: string; status: string }>(
        'SELECT role, status FROM users WHERE id = $1::uuid',
        [admin2.id],
      );
      expect(row.rows[0]).toMatchObject({ role: 'admin', status: 'active' });
    } finally {
      await exec(`UPDATE users SET status = 'active' WHERE id = $1::uuid`, [admin.id]);
      await setRole(adminNoMfa.id, 'admin');
    }
  });

  it('ALLOWS the demotion once a second active admin exists', async () => {
    const spare = await staffAccount('admin');
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${spare.id}/role`,
      payload: { role: 'user', reason: 'stepped down' },
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ previous_role: string }>().previous_role).toBe('admin');
  });

  it('FLAGS mfa_required when promoting into an MFA-required role', async () => {
    const target = await userAccount();
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${target.id}/role`,
      payload: { role: 'moderator', reason: 'trusted contributor' },
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ mfa_required: boolean; user: AdminUserRow; previous_role: string }>();
    expect(body.mfa_required).toBe(true);
    expect(body.previous_role).toBe('user');
    expect(body.user.role).toBe('moderator');

    // ...and the grant really is inert until they enrol: their existing session
    // has mfa:false, so the staff gate still refuses it.
    const stillBlocked = await app.inject({
      url: '/v1/admin/users',
      headers: bearer(target.token),
    });
    expect(stillBlocked.statusCode).toBe(403);
  });

  it('does NOT flag mfa_required for a plain user role', async () => {
    const target = await userAccount();
    await setRole(target.id, 'moderator');
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${target.id}/role`,
      payload: { role: 'user' },
      headers: bearer(admin.token),
    });
    expect(res.json<{ mfa_required: boolean }>().mfa_required).toBe(false);
  });

  it('a DEMOTION revokes the target’s sessions; a promotion does not', async () => {
    const target = await userAccount();
    const promoted = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${target.id}/role`,
      payload: { role: 'editor' },
      headers: bearer(admin.token),
    });
    expect(promoted.json<{ sessions_revoked: number | null }>().sessions_revoked).toBeNull();

    const demoted = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${target.id}/role`,
      payload: { role: 'user' },
      headers: bearer(admin.token),
    });
    expect(demoted.json<{ sessions_revoked: number | null }>().sessions_revoked).toBeGreaterThan(0);
  });

  it('is ADMIN-only: a moderator cannot assign roles at all', async () => {
    const target = await userAccount();
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${target.id}/role`,
      payload: { role: 'admin' },
      headers: bearer(moderator.token),
    });
    expect(res.statusCode).toBe(403);
    const row = await exec<{ role: string }>('SELECT role FROM users WHERE id = $1::uuid', [
      target.id,
    ]);
    expect(row.rows[0]!.role).toBe('user');
  });

  it('rejects a role outside the vocabulary with a 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${plain.id}/role`,
      payload: { role: 'superuser' },
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(400);
  });

  it('audits every role change with before and after', async () => {
    const target = await userAccount();
    await app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${target.id}/role`,
      payload: { role: 'editor', reason: 'catalog work' },
      headers: bearer(admin.token),
    });
    const rows = await exec<{ actor_id: string; payload: Record<string, unknown> }>(
      `SELECT actor_id::text AS actor_id, payload FROM audit_log
        WHERE action = 'admin.user_role_changed' AND target_id = $1`,
      [target.id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.actor_id).toBe(admin.id);
    expect(rows.rows[0]!.payload).toMatchObject({
      from_role: 'user',
      to_role: 'editor',
      reason: 'catalog work',
    });
  });
});

// ===========================================================================
describe('seller onboarding — intake plus exactly one role grant', () => {
  let applicant: Account;
  let applicationId = '';

  it('lets an authenticated user apply, and audits it', async () => {
    applicant = await userAccount();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/seller-applications',
      payload: {
        business_name: 'Cascara Coffee Roasters',
        contact_email: 'HELLO@Cascara.test',
        notes: 'Small batch, two-year-old roastery.',
      },
      headers: bearer(applicant.token),
    });
    expect(res.statusCode).toBe(201);
    const created = res.json<SellerApplication>();
    applicationId = created.id;
    expect(created).toMatchObject({
      user_id: applicant.id,
      status: 'pending',
      contact_email: 'hello@cascara.test', // normalised
      reviewed_by: null,
      reviewed_at: null,
    });

    const audited = await exec<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_log
        WHERE action = 'admin.seller_application_submitted' AND target_id = $1`,
      [created.id],
    );
    expect(audited.rows[0]!.count).toBe(1);
  });

  it('refuses a second PENDING application from the same user (409)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/seller-applications',
      payload: { business_name: 'Second Shop', contact_email: 'again@cascara.test' },
      headers: bearer(applicant.token),
    });
    expect(res.statusCode).toBe(409);
  });

  it('requires authentication to apply', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/seller-applications',
      payload: { business_name: 'Anon Shop', contact_email: 'anon@cascara.test' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('shows the applicant their own application but not the queue', async () => {
    const mine = await app.inject({
      url: '/v1/seller-applications/me',
      headers: bearer(applicant.token),
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json<{ items: SellerApplication[] }>().items.map((a) => a.id)).toContain(
      applicationId,
    );

    const queue = await app.inject({
      url: '/v1/admin/seller-applications',
      headers: bearer(applicant.token),
    });
    expect(queue.statusCode).toBe(403);

    // ...and "me" cannot be widened into someone else's rows. The app-wide Ajv
    // config (Fastify's default `removeAdditional: true`) strips the unknown
    // parameter rather than 400-ing, so the invariant to assert is the one that
    // matters: the scope is applied in SQL from the actor's id, so a smuggled
    // `user_id` changes nothing.
    const widened = await app.inject({
      url: `/v1/seller-applications/me?user_id=${admin.id}`,
      headers: bearer(applicant.token),
    });
    expect(widened.statusCode).toBe(200);
    const rows = widened.json<{ items: SellerApplication[] }>().items;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((a) => a.user_id === applicant.id)).toBe(true);
  });

  it('staff see the queue and can filter by status', async () => {
    const res = await app.inject({
      url: '/v1/admin/seller-applications?status=pending&limit=100',
      headers: bearer(moderator.token),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: SellerApplication[] }>().items;
    expect(items.map((a) => a.id)).toContain(applicationId);
    expect(items.every((a) => a.status === 'pending')).toBe(true);
  });

  it('APPROVAL promotes the applicant to seller_owner and audits both facts', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/admin/seller-applications/${applicationId}/approve`,
      payload: { reason: 'verified roastery' },
      headers: bearer(moderator.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      application: SellerApplication;
      role_granted: boolean;
      role: string;
      mfa_required: boolean;
    }>();
    expect(body.role_granted).toBe(true);
    expect(body.role).toBe('seller_owner');
    // seller_owner is in MFA_REQUIRED_ROLES — the console must say so.
    expect(body.mfa_required).toBe(true);
    expect(body.application.status).toBe('approved');
    expect(body.application.reviewed_by).toBe(moderator.id);
    expect(body.application.reviewed_at).not.toBeNull();

    const row = await exec<{ role: string }>('SELECT role FROM users WHERE id = $1::uuid', [
      applicant.id,
    ]);
    expect(row.rows[0]!.role).toBe('seller_owner');

    const actions = await exec<{ action: string }>(
      `SELECT action FROM audit_log
        WHERE (target_id = $1 OR target_id = $2) AND action LIKE 'admin.%'
        ORDER BY id`,
      [applicationId, applicant.id],
    );
    const names = actions.rows.map((r) => r.action);
    expect(names).toContain('admin.seller_application_approved');
    expect(names).toContain('admin.user_role_changed');
  });

  it('refuses to decide an already-decided application (409)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/admin/seller-applications/${applicationId}/approve`,
      payload: {},
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects an application without touching the role', async () => {
    const other = await userAccount();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/seller-applications',
      payload: { business_name: 'Dubious Beans', contact_email: 'nope@dubious.test' },
      headers: bearer(other.token),
    });
    const id = created.json<SellerApplication>().id;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/admin/seller-applications/${id}/reject`,
      payload: { reason: 'unverifiable business address' },
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<SellerApplication>().status).toBe('rejected');

    const row = await exec<{ role: string }>('SELECT role FROM users WHERE id = $1::uuid', [
      other.id,
    ]);
    expect(row.rows[0]!.role).toBe('user');

    // A rejected applicant may apply again — the unique index is partial.
    const again = await app.inject({
      method: 'POST',
      url: '/v1/seller-applications',
      payload: { business_name: 'Dubious Beans v2', contact_email: 'nope@dubious.test' },
      headers: bearer(other.token),
    });
    expect(again.statusCode).toBe(201);
  });

  it('does NOT downgrade an existing staff member who applies', async () => {
    const editor = await staffAccount('editor');
    const created = await app.inject({
      method: 'POST',
      url: '/v1/seller-applications',
      payload: { business_name: 'Editor Beans', contact_email: 'editor@beans.test' },
      headers: bearer(editor.token),
    });
    const id = created.json<SellerApplication>().id;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/admin/seller-applications/${id}/approve`,
      payload: {},
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ role_granted: boolean; role: string }>()).toMatchObject({
      role_granted: false,
      role: 'editor',
    });

    const row = await exec<{ role: string }>('SELECT role FROM users WHERE id = $1::uuid', [
      editor.id,
    ]);
    expect(row.rows[0]!.role).toBe('editor');
  });
});

// ===========================================================================
describe('moderation queue', () => {
  let reporter: Account;
  let reportId = '';
  const target = 'a3f1c2d4-0000-4000-8000-00000000cafe';

  it('accepts a report from any authenticated user and audits it', async () => {
    reporter = await userAccount();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: {
        target_type: 'recipe',
        target_id: target,
        reason: 'spam',
        detail: 'Affiliate links in every step.',
      },
      headers: bearer(reporter.token),
    });
    expect(res.statusCode).toBe(201);
    const created = res.json<Report>();
    reportId = created.id;
    expect(created).toMatchObject({
      reporter_id: reporter.id,
      status: 'open',
      reason: 'spam',
      reviewed_by: null,
      reviewed_at: null,
      resolution: null,
    });

    const audited = await exec<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_log
        WHERE action = 'admin.report_created' AND target_id = $1`,
      [created.id],
    );
    expect(audited.rows[0]!.count).toBe(1);
  });

  it('REFUSES a duplicate OPEN report for the same target (partial unique index)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: { target_type: 'recipe', target_id: target, reason: 'harassment' },
      headers: bearer(reporter.token),
    });
    expect(res.statusCode).toBe(409);

    // The index is per (reporter, target): a DIFFERENT reporter may still file.
    const someoneElse = await userAccount();
    const theirs = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: { target_type: 'recipe', target_id: target, reason: 'spam' },
      headers: bearer(someoneElse.token),
    });
    expect(theirs.statusCode).toBe(201);

    // ...and the SAME reporter may report a DIFFERENT target.
    const otherTarget = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: { target_type: 'comment', target_id: 'c-1', reason: 'off_topic' },
      headers: bearer(reporter.token),
    });
    expect(otherTarget.statusCode).toBe(201);
  });

  it('requires authentication, and refuses self-reporting', async () => {
    const anon = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: { target_type: 'recipe', target_id: 'x', reason: 'spam' },
    });
    expect(anon.statusCode).toBe(401);

    const self = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: { target_type: 'user', target_id: reporter.id, reason: 'spam' },
      headers: bearer(reporter.token),
    });
    expect(self.statusCode).toBe(400);
  });

  it('lets the reporter read their own report but not the queue', async () => {
    const own = await app.inject({
      url: `/v1/reports/${reportId}`,
      headers: bearer(reporter.token),
    });
    expect(own.statusCode).toBe(200);

    const mine = await app.inject({ url: '/v1/reports/me', headers: bearer(reporter.token) });
    expect(mine.json<{ items: Report[] }>().items.every((r) => r.reporter_id === reporter.id)).toBe(
      true,
    );

    const stranger = await userAccount();
    const nope = await app.inject({
      url: `/v1/reports/${reportId}`,
      headers: bearer(stranger.token),
    });
    // A stranger must never learn who reported whom.
    expect(nope.statusCode).toBe(403);

    const queue = await app.inject({ url: '/v1/admin/reports', headers: bearer(reporter.token) });
    expect(queue.statusCode).toBe(403);
  });

  it('staff claim (open → reviewing) exactly once', async () => {
    const claimed = await app.inject({
      method: 'POST',
      url: `/v1/admin/reports/${reportId}/claim`,
      payload: {},
      headers: bearer(moderator.token),
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json<Report>()).toMatchObject({
      status: 'reviewing',
      reviewed_by: moderator.id,
    });

    const again = await app.inject({
      method: 'POST',
      url: `/v1/admin/reports/${reportId}/claim`,
      payload: {},
      headers: bearer(admin.token),
    });
    expect(again.statusCode).toBe(409);
  });

  it('a claimed report still blocks a duplicate from the same reporter', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: { target_type: 'recipe', target_id: target, reason: 'spam' },
      headers: bearer(reporter.token),
    });
    expect(res.statusCode).toBe(409);
  });

  it('staff resolve with an outcome and a resolution, and it is audited', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/admin/reports/${reportId}/resolve`,
      payload: { outcome: 'actioned', resolution: 'Recipe unpublished; author warned.' },
      headers: bearer(moderator.token),
    });
    expect(res.statusCode).toBe(200);
    const resolved = res.json<Report>();
    expect(resolved).toMatchObject({ status: 'actioned', reviewed_by: moderator.id });
    expect(resolved.reviewed_at).not.toBeNull();
    expect(resolved.resolution).toContain('unpublished');

    const audited = await exec<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM audit_log WHERE action = 'admin.report_resolved' AND target_id = $1`,
      [reportId],
    );
    expect(audited.rows).toHaveLength(1);
    expect(audited.rows[0]!.payload).toMatchObject({ outcome: 'actioned' });

    // Terminal: it cannot be re-decided.
    const again = await app.inject({
      method: 'POST',
      url: `/v1/admin/reports/${reportId}/resolve`,
      payload: { outcome: 'dismissed', resolution: 'changed my mind' },
      headers: bearer(admin.token),
    });
    expect(again.statusCode).toBe(409);
  });

  it('a resolved report frees the reporter to file again', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: { target_type: 'recipe', target_id: target, reason: 'spam', detail: 'Still there.' },
      headers: bearer(reporter.token),
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects an out-of-vocabulary reason or target type with a 400', async () => {
    for (const payload of [
      { target_type: 'recipe', target_id: 'z', reason: 'i-dont-like-it' },
      { target_type: 'spaceship', target_id: 'z', reason: 'spam' },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/reports',
        payload,
        headers: bearer(reporter.token),
      });
      expect(res.statusCode).toBe(400);
    }
  });
});

// ===========================================================================
describe('audit log viewer', () => {
  it('returns rows to staff, newest first, with working filters', async () => {
    const res = await app.inject({
      url: '/v1/admin/audit?limit=100',
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: AuditLogEntry[] }>().items;
    expect(items.length).toBeGreaterThan(0);

    const times = items.map((e) => Date.parse(e.created_at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const byActor = await app.inject({
      url: `/v1/admin/audit?actor_id=${admin.id}&limit=100`,
      headers: bearer(admin.token),
    });
    expect(
      byActor.json<{ items: AuditLogEntry[] }>().items.every((e) => e.actor_id === admin.id),
    ).toBe(true);

    const byAction = await app.inject({
      url: '/v1/admin/audit?action=admin.user_suspended&limit=100',
      headers: bearer(admin.token),
    });
    const suspensions = byAction.json<{ items: AuditLogEntry[] }>().items;
    expect(suspensions.length).toBeGreaterThan(0);
    expect(suspensions.every((e) => e.action === 'admin.user_suspended')).toBe(true);
    expect(suspensions.every((e) => e.target_type === 'user')).toBe(true);

    const byTarget = await app.inject({
      url: '/v1/admin/audit?target_type=report&limit=100',
      headers: bearer(admin.token),
    });
    expect(
      byTarget.json<{ items: AuditLogEntry[] }>().items.every((e) => e.target_type === 'report'),
    ).toBe(true);
  });

  it('pages on a bigint keyset cursor without repeating a row', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 100; guard += 1) {
      const url: string = `/v1/admin/audit?limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await app.inject({ url, headers: bearer(admin.token) });
      expect(page.statusCode).toBe(200);
      const body = page.json<{ items: AuditLogEntry[]; next_cursor: string | null }>();
      seen.push(...body.items.map((e) => e.id));
      cursor = body.next_cursor;
      if (!cursor) break;
    }
    expect(seen.length).toBeGreaterThan(5);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('filters by a date range', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const none = await app.inject({
      url: `/v1/admin/audit?from=${encodeURIComponent(future)}`,
      headers: bearer(admin.token),
    });
    expect(none.json<{ items: AuditLogEntry[] }>().items).toHaveLength(0);
  });

  it('is read-only — the table itself refuses UPDATE and DELETE', async () => {
    await expect(
      exec(`UPDATE audit_log SET action = 'tampered' WHERE action = 'admin.user_suspended'`),
    ).rejects.toThrow(/append-only/);
    await expect(exec(`DELETE FROM audit_log WHERE action = 'admin.user_suspended'`)).rejects.toThrow(
      /append-only/,
    );
  });
});

// ===========================================================================
describe('bootstrap (a) — the ADMIN_EMAILS allowlist', () => {
  /**
   * The allowlist bootstrap CLOSES once the platform has an active admin, and
   * the shared harness creates several in its beforeAll. Park them for the
   * duration of this block so these tests run against a genuinely
   * un-bootstrapped deployment — the only state the mechanism is meant to run
   * in — and put them back afterwards for the suites that follow.
   */
  let parkedAdmins: string[] = [];
  beforeAll(async () => {
    const res = await exec<{ id: string }>(
      `SELECT id::text AS id FROM users WHERE role = 'admin' AND status = 'active'`,
    );
    parkedAdmins = res.rows.map((r) => r.id);
    if (parkedAdmins.length > 0) {
      await exec(`UPDATE users SET role = 'user' WHERE id = ANY($1::uuid[])`, [parkedAdmins]);
    }
  });
  afterAll(async () => {
    if (parkedAdmins.length > 0) {
      await exec(`UPDATE users SET role = 'admin' WHERE id = ANY($1::uuid[])`, [parkedAdmins]);
    }
  });

  it('parses the allowlist forgivingly but never invents an entry', () => {
    expect([...parseAdminEmails('a@b.test, c@d.test;  e@f.test ')]).toEqual([
      'a@b.test',
      'c@d.test',
      'e@f.test',
    ]);
    expect(parseAdminEmails('').size).toBe(0);
    expect(parseAdminEmails('not-an-email, ,,').size).toBe(0);
    expect([...parseAdminEmails('MiXeD@Case.TEST')]).toEqual(['mixed@case.test']);
  });

  it('REFUSES to promote an allowlisted address that is NOT VERIFIED', async () => {
    const tag = uniq();
    // Register but deliberately do NOT verify.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email: 'ghost@brewcult.test', handle: `ghost${tag}`, password: PASSWORD },
    });
    expect(res.statusCode).toBe(202);

    const outcome = await promoteAllowlistedAdmin(defaultAdminDb, 'ghost@brewcult.test');
    expect(outcome.status).toBe('email_unverified');

    const row = await exec<{ role: string }>('SELECT role FROM users WHERE email = $1', [
      'ghost@brewcult.test',
    ]);
    expect(row.rows[0]!.role).toBe('user');

    // ...and no audit row was written for a refusal.
    const audited = await exec<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_log
        WHERE action = 'admin.bootstrap_granted' AND payload->>'email' = 'ghost@brewcult.test'`,
    );
    expect(audited.rows[0]!.count).toBe(0);
  });

  it('promotes on a real login through identity’s own route, with a system audit row', async () => {
    // The hook is installed on this app because ADMIN_EMAILS is set; nothing in
    // the identity module was modified to make this work.
    const founder = await registerAndVerify('founder@brewcult.test');

    const before = await exec<{ role: string }>('SELECT role FROM users WHERE id = $1::uuid', [
      founder.id,
    ]);
    // verify-email is itself a trigger, so the promotion may already have run.
    const token = await plainLogin(founder.email);
    expect(token).toBeTruthy();

    const after = await exec<{ role: string }>('SELECT role FROM users WHERE id = $1::uuid', [
      founder.id,
    ]);
    expect(after.rows[0]!.role).toBe('admin');
    expect(['user', 'admin']).toContain(before.rows[0]!.role);

    const audited = await exec<{ actor_id: string | null; payload: Record<string, unknown> }>(
      `SELECT actor_id::text AS actor_id, payload FROM audit_log
        WHERE action = 'admin.bootstrap_granted' AND target_id = $1`,
      [founder.id],
    );
    expect(audited.rows).toHaveLength(1); // idempotent: exactly one, not one per login
    expect(audited.rows[0]!.actor_id).toBeNull(); // system
    expect(audited.rows[0]!.payload).toMatchObject({
      actor: 'system',
      mechanism: 'admin_emails_allowlist',
      from_role: 'user',
      to_role: 'admin',
      mfa_required: true,
    });
  });

  it('CLOSES once the platform has an admin — a listed address is no longer promoted', async () => {
    // founder@ was promoted by the test above, so the deadlock ADMIN_EMAILS
    // exists to break is now broken. From here the variable must be inert:
    // leaving it in a .env.prod that gets copied forward should not hand admin
    // to anyone who later receives mail at a listed address.
    const admins = await exec<{ count: number }>(
      `SELECT count(*)::int AS count FROM users WHERE role = 'admin' AND status = 'active'`,
    );
    expect(admins.rows[0]!.count).toBeGreaterThan(0);

    // A DIFFERENT allowlisted address, verified and otherwise perfectly
    // promotable — refused purely because the bootstrap has already served
    // its purpose.
    const latecomer = await registerAndVerify('second@brewcult.test');
    const outcome = await promoteAllowlistedAdmin(
      defaultAdminDb,
      'second@brewcult.test',
      new Set(['second@brewcult.test']),
    );
    expect(outcome.status).toBe('bootstrap_closed');

    const row = await exec<{ role: string }>('SELECT role FROM users WHERE id = $1::uuid', [
      latecomer.id,
    ]);
    expect(row.rows[0]!.role).toBe('user');

    // A refusal is not an audit event — nothing was granted.
    const audited = await exec<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_log
        WHERE action = 'admin.bootstrap_granted' AND payload->>'email' = 'second@brewcult.test'`,
    );
    expect(audited.rows[0]!.count).toBe(0);
  });

  it('is idempotent — logging in again writes no second audit row', async () => {
    await plainLogin('founder@brewcult.test');
    const audited = await exec<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_log
        WHERE action = 'admin.bootstrap_granted' AND payload->>'email' = 'founder@brewcult.test'`,
    );
    expect(audited.rows[0]!.count).toBe(1);
  });

  it('ignores addresses that are not on the allowlist', async () => {
    const outsider = await registerAndVerify();
    await plainLogin(outsider.email);
    const row = await exec<{ role: string }>('SELECT role FROM users WHERE id = $1::uuid', [
      outsider.id,
    ]);
    expect(row.rows[0]!.role).toBe('user');
  });

  it('the promoted admin STILL cannot use the console until MFA is enrolled', async () => {
    const token = await plainLogin('founder@brewcult.test');
    const blocked = await app.inject({ url: '/v1/admin/users', headers: bearer(token) });
    expect(blocked.statusCode).toBe(403);

    // Enrol, sign in again, and the same account now passes the gate.
    const secret = await enrolMfa(token);
    const staffToken = await mfaLogin('founder@brewcult.test', secret);
    const allowed = await app.inject({ url: '/v1/admin/users', headers: bearer(staffToken) });
    expect(allowed.statusCode).toBe(200);
  });
});

// ===========================================================================
describe('bootstrap (b) — the break-glass CLI path', () => {
  it('grants by email, audits as system, and is idempotent', async () => {
    const target = await registerAndVerify();

    const first = await grantRoleByEmail(defaultAdminDb, {
      email: target.email.toUpperCase(), // case-insensitive: users.email is citext
      role: 'admin',
      mechanism: 'cli',
    });
    expect(first.status).toBe('granted');
    if (first.status === 'granted') {
      expect(first.previous_role).toBe('user');
      expect(first.mfa_required).toBe(true);
    }

    const again = await grantRoleByEmail(defaultAdminDb, {
      email: target.email,
      role: 'admin',
      mechanism: 'cli',
    });
    expect(again.status).toBe('already_granted');

    const audited = await exec<{ actor_id: string | null; payload: Record<string, unknown> }>(
      `SELECT actor_id::text AS actor_id, payload FROM audit_log
        WHERE action = 'admin.bootstrap_granted' AND target_id = $1`,
      [target.id],
    );
    expect(audited.rows).toHaveLength(1);
    expect(audited.rows[0]!.actor_id).toBeNull();
    expect(audited.rows[0]!.payload).toMatchObject({ mechanism: 'cli', actor: 'system' });
  });

  it('REFUSES an unverified address', async () => {
    const tag = uniq();
    const email = `unverified-${tag}@example.com`;
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email, handle: `unver${tag}`, password: PASSWORD },
    });

    const outcome = await grantRoleByEmail(defaultAdminDb, {
      email,
      role: 'admin',
      mechanism: 'cli',
    });
    expect(outcome.status).toBe('email_unverified');

    const row = await exec<{ role: string }>('SELECT role FROM users WHERE email = $1', [email]);
    expect(row.rows[0]!.role).toBe('user');
  });

  it('REFUSES a suspended account — an env var must not undo a suspension', async () => {
    const victim = await userAccount();
    await app.inject({
      method: 'POST',
      url: `/v1/admin/users/${victim.id}/suspend`,
      payload: { reason: 'abuse' },
      headers: bearer(admin.token),
    });

    const outcome = await grantRoleByEmail(defaultAdminDb, {
      email: victim.email,
      role: 'admin',
      mechanism: 'cli',
    });
    expect(outcome.status).toBe('account_not_active');
  });

  it('REFUSES an unknown address', async () => {
    const outcome = await grantRoleByEmail(defaultAdminDb, {
      email: 'nobody@nowhere.test',
      role: 'admin',
      mechanism: 'cli',
    });
    expect(outcome.status).toBe('user_not_found');
  });

  it('admin:list surfaces staff and their MFA posture', async () => {
    const staff = await listStaff(defaultAdminDb);
    expect(staff.length).toBeGreaterThan(0);
    expect(staff.every((u) => u.role !== 'user')).toBe(true);
    expect(staff.some((u) => u.id === admin.id && u.mfa_enabled)).toBe(true);
    // The account that holds `admin` without MFA is exactly what the CLI warns
    // about: a role it cannot actually exercise.
    expect(staff.some((u) => u.id === adminNoMfa.id && !u.mfa_enabled)).toBe(true);
  });
});
