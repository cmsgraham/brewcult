/**
 * Notifications: the guarantees, against a real Postgres engine.
 *
 * PGlite with db/migrations applied verbatim, so the CHECK constraint and the
 * UNIQUE index in 0009 are the ones actually enforcing these tests — not a
 * mock's idea of them.
 *
 * What is worth asserting here is narrow and specific:
 *   - an opt-out is honoured (the promise we make in every footer)
 *   - a second send never happens (the ledger, under a scheduler with no lock)
 *   - an unsubscribe token cannot be forged, replayed across types, or used to
 *     opt somebody IN
 *   - security mail is not reachable through this module at all
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = 'test-notification-signing-secret';
process.env.APP_URL = 'https://brewcult.test';

const holder = { db: null as PGlite | null };

vi.mock('../src/lib/db.js', () => ({
  query: (text: string, params: readonly unknown[] = []) =>
    holder.db!.query(text, params as unknown[]),
  getPool: () => {
    throw new Error('getPool() is not available in the PGlite test harness');
  },
  closePool: async () => {},
}));

const {
  NOTIFICATION_TYPES,
  createUnsubscribeToken,
  isEnabled,
  listPreferences,
  sendNotification,
  setNotificationMailer,
  setPreference,
  verifyUnsubscribeToken,
  weeklyRecapKey,
} = await import('../src/modules/notifications/index.js');

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const MIGRATIONS = [
  'db/migrations/0001_extensions.sql',
  'db/migrations/0002_identity.sql',
  'db/migrations/0003_catalog.sql',
  'db/migrations/0004_catalog_search_indexes.sql',
  'db/migrations/0005_identity_extras.sql',
  'db/migrations/0006_brewing.sql',
  'db/migrations/0007_admin.sql',
  'db/migrations/0008_media.sql',
  'db/migrations/0009_notifications.sql',
];

const exec = (async (text: string, params: readonly unknown[] = []) =>
  holder.db!.query(text, params as unknown[])) as Parameters<typeof sendNotification>[0];

let userId = '';
let sent: { to: string; subject: string; template: string; headers: Record<string, string> }[] = [];

async function makeUser(email: string, verified = true): Promise<string> {
  const res = await holder.db!.query<{ id: string }>(
    `INSERT INTO users (email, handle, display_name, password_hash, email_verified_at)
          VALUES ($1, $2, $3, 'x', ${verified ? 'now()' : 'NULL'})
       RETURNING id::text AS id`,
    [email, email.split('@')[0], 'Test Person'],
  );
  return res.rows[0]!.id;
}

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
  userId = await makeUser('recipient@brewcult.test');
}, 180_000);

afterAll(async () => {
  setNotificationMailer(null);
  await holder.db?.close();
});

beforeEach(async () => {
  sent = [];
  setNotificationMailer(async (message) => {
    sent.push({
      to: message.to,
      subject: message.subject,
      template: message.template,
      headers: message.headers,
    });
  });
  await holder.db!.query('DELETE FROM notification_deliveries');
  await holder.db!.query('DELETE FROM notification_preferences');
});

describe('the vocabulary agrees across all three layers', () => {
  it('every TS type is accepted by the CHECK constraint in 0009', async () => {
    for (const type of NOTIFICATION_TYPES) {
      await expect(setPreference(exec, userId, type, false)).resolves.toBeUndefined();
    }
  });

  it('a type the TS union does not know is rejected by the database', async () => {
    await expect(
      holder.db!.query(
        `INSERT INTO notification_preferences (user_id, notification_type)
              VALUES ($1::uuid, 'marketing_blast')`,
        [userId],
      ),
    ).rejects.toThrow();
  });
});

describe('preferences', () => {
  it('defaults to enabled with no row — a new type is never silently off', async () => {
    const prefs = await listPreferences(exec, userId);
    expect(prefs).toHaveLength(NOTIFICATION_TYPES.length);
    expect(prefs.every((p) => p.email_enabled)).toBe(true);
    expect(await isEnabled(exec, userId, 'weekly_recap')).toBe(true);
  });

  it('records only the deviation', async () => {
    await setPreference(exec, userId, 'weekly_recap', false);
    const rows = await holder.db!.query('SELECT * FROM notification_preferences');
    expect(rows.rows).toHaveLength(1); // not one row per type
    expect(await isEnabled(exec, userId, 'weekly_recap')).toBe(false);
    expect(await isEnabled(exec, userId, 'recipe_forked')).toBe(true);
  });

  it('is idempotent — toggling twice does not duplicate-key', async () => {
    await setPreference(exec, userId, 'weekly_recap', false);
    await setPreference(exec, userId, 'weekly_recap', true);
    expect(await isEnabled(exec, userId, 'weekly_recap')).toBe(true);
  });
});

describe('sending', () => {
  it('sends once and attaches RFC 8058 one-click headers', async () => {
    const outcome = await sendNotification(exec, {
      userId,
      type: 'weekly_recap',
      dedupeKey: 'weekly_recap:2026-W32',
      subject: 'Your week in coffee',
    });

    expect(outcome).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(sent[0]!.headers['List-Unsubscribe']).toMatch(/^<https:\/\/brewcult\.test\/unsubscribe\?token=/);
  });

  it('HONOURS AN OPT-OUT — the promise made in every footer', async () => {
    await setPreference(exec, userId, 'weekly_recap', false);
    const outcome = await sendNotification(exec, {
      userId,
      type: 'weekly_recap',
      dedupeKey: 'weekly_recap:2026-W33',
      subject: 'Your week in coffee',
    });
    expect(outcome).toBe('opted_out');
    expect(sent).toHaveLength(0);
  });

  it('NEVER SENDS TWICE for the same dedupe key, however many runs', async () => {
    const input = {
      userId,
      type: 'weekly_recap' as const,
      dedupeKey: 'weekly_recap:2026-W34',
      subject: 'Your week in coffee',
    };
    const outcomes = await Promise.all([
      sendNotification(exec, input),
      sendNotification(exec, input),
      sendNotification(exec, input),
    ]);

    // Exactly one winner; the others lose the INSERT race, not a check.
    expect(outcomes.filter((o) => o === 'sent')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'already_sent')).toHaveLength(2);
    expect(sent).toHaveLength(1);
  });

  it('will not mail an unverified address', async () => {
    const unverified = await makeUser('unverified@brewcult.test', false);
    const outcome = await sendNotification(exec, {
      userId: unverified,
      type: 'weekly_recap',
      dedupeKey: 'weekly_recap:2026-W35',
      subject: 'Your week in coffee',
    });
    expect(outcome).toBe('no_recipient');
    expect(sent).toHaveLength(0);
  });

  it('releases the claim when the transport fails, so a retry can succeed', async () => {
    setNotificationMailer(async () => {
      throw new Error('smtp down');
    });
    const input = {
      userId,
      type: 'recipe_forked' as const,
      dedupeKey: 'recipe_forked:abc',
      subject: 'Someone built on your recipe',
    };
    expect(await sendNotification(exec, input)).toBe('failed');

    // A failed send that kept its claim would lose the notification forever.
    const rows = await holder.db!.query('SELECT * FROM notification_deliveries');
    expect(rows.rows).toHaveLength(0);

    setNotificationMailer(async (m) => {
      sent.push({ to: m.to, subject: m.subject, template: m.template, headers: m.headers });
    });
    expect(await sendNotification(exec, input)).toBe('sent');
  });
});

describe('unsubscribe tokens', () => {
  it('round-trips', () => {
    const token = createUnsubscribeToken(userId, 'weekly_recap');
    expect(verifyUnsubscribeToken(token)).toEqual({ userId, type: 'weekly_recap' });
  });

  it('rejects a forged signature', () => {
    expect(verifyUnsubscribeToken(`${userId}.weekly_recap.not-a-real-signature`)).toBeNull();
  });

  it('CANNOT BE REPLAYED ACROSS TYPES — the signature is scoped to one kind', () => {
    const token = createUnsubscribeToken(userId, 'weekly_recap');
    const [id, , sig] = token.split('.');
    expect(verifyUnsubscribeToken(`${id}.recipe_forked.${sig}`)).toBeNull();
  });

  it('rejects a type the vocabulary does not contain', () => {
    const token = createUnsubscribeToken(userId, 'weekly_recap');
    const [id, , sig] = token.split('.');
    expect(verifyUnsubscribeToken(`${id}.marketing_blast.${sig}`)).toBeNull();
  });

  it('rejects malformed tokens without throwing', () => {
    for (const bad of ['', 'x', 'a.b', 'a.b.c.d', '..']) {
      expect(verifyUnsubscribeToken(bad)).toBeNull();
    }
  });
});

describe('weekly recap dedupe key', () => {
  it('is stable inside a week and changes between weeks', () => {
    const monday = new Date('2026-08-03T00:00:00Z');
    const sunday = new Date('2026-08-09T23:59:00Z');
    const nextWeek = new Date('2026-08-10T00:00:00Z');

    expect(weeklyRecapKey(monday)).toBe(weeklyRecapKey(sunday));
    expect(weeklyRecapKey(nextWeek)).not.toBe(weeklyRecapKey(monday));
    expect(weeklyRecapKey(monday)).toMatch(/^weekly_recap:\d{4}-W\d{2}$/);
  });
});
