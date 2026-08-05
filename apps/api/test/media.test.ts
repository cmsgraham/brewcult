/**
 * Media module — integration suite (EF §1.4: "each module's API + DB, no mocks
 * of SQL").
 *
 * The database is a real PostgreSQL 16 engine (PGlite, the WASM build) with
 * db/migrations/0001..0008 applied VERBATIM apart from the extensions PGlite
 * does not ship — `vector` (0001) and `pg_trgm` (0004). So the CHECK
 * constraints of 0008, the deferred `brew_sessions` FK and the four attachment
 * columns are the real thing, not a fixture.
 *
 * `lib/db` is one of two mocked seams — pointed at the in-process database
 * exactly as the admin and identity suites do. That means IDENTITY'S OWN ROUTES
 * run here, so every token below comes from a REAL registration, a REAL email
 * verification, a REAL TOTP enrolment and a REAL login: a staff session is a
 * staff session because the actor cleared an MFA challenge, not because a
 * fixture asserted `{ role: 'admin', mfa: true }`.
 *
 * The second seam is OBJECT STORAGE, injected as an in-memory map
 * (`memoryStorage()`). No live MinIO is required, and the map holds the EXACT
 * bytes the pipeline produced — which is what lets the tests below assert on
 * the stored object itself (no EXIF, no payload) rather than on a promise that
 * it was written correctly.
 *
 * SHARP IS NOT MOCKED. Mocking the re-encoder would delete the only thing this
 * module is for.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import Fastify, { type FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => {
  // Must be in place before `lib/env.ts` memoises the environment.
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'media-lane-test-secret-at-least-32-characters';
  process.env.APP_URL = 'http://localhost:3000';
  process.env.API_URL = 'http://localhost:4000';
  process.env.MEDIA_BASE_URL = 'https://media.brewcult.test/brewcult-media';
  delete process.env.ADMIN_EMAILS;
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
const {
  registerMediaRoutes,
  assertMediaUsable,
  memoryStorage,
  defaultMediaDb,
  listOwnedStorageKeys,
  MEDIA_KINDS,
  MEDIA_STATUSES,
  QUOTA_MAX_UPLOADS,
} = await import('../src/modules/media/index.js');
import type { IdentityMailMessage } from '../src/modules/identity/mailer.js';
import type { MediaDto } from '../src/modules/media/index.js';

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
  'db/migrations/0012_equipment_submission_media.sql',
];

let app: FastifyInstance;
let storage: ReturnType<typeof memoryStorage>;
const mails: IdentityMailMessage[] = [];

const exec = <T = Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<{ rows: T[] }> =>
  holder.db!.query(text, params as unknown[]) as unknown as Promise<{ rows: T[] }>;

// ---------------------------------------------------------------------------
// Accounts (identical mechanics to the admin suite — real auth, no shortcuts)
// ---------------------------------------------------------------------------

const PASSWORD = 'a-long-enough-passphrase-42';
let seq = 0;
const uniq = (): string => `${Date.now().toString(36)}${(seq += 1)}`;

interface Account {
  id: string;
  email: string;
  handle: string;
  token: string;
}

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

const lastMail = (to: string, template: string): IdentityMailMessage | undefined =>
  [...mails].reverse().find((m) => m.to === to && m.template === template);

const nextTotpToken = (secret: string): Promise<string> =>
  currentTotpToken(secret, Math.floor(Date.now() / 1000) + 30);

async function registerAndVerify(): Promise<{ id: string; email: string; handle: string }> {
  const tag = uniq();
  const address = `brewer-${tag}@example.com`;
  const handle = `brewer${tag}`;

  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: { email: address, handle, password: PASSWORD },
      })
    ).statusCode,
  ).toBe(202);

  const mail = lastMail(address, 'verify_email');
  expect(mail).toBeDefined();
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/auth/verify-email',
        payload: { email: address, code: mail!.data.code },
      })
    ).statusCode,
  ).toBe(200);

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

async function mfaLogin(email: string, secret: string): Promise<string> {
  const challenge = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email, password: PASSWORD },
  });
  const mfaToken = challenge.json<{ mfa_token?: string }>().mfa_token;
  expect(mfaToken).toBeTruthy();
  const verified = await app.inject({
    method: 'POST',
    url: '/v1/auth/mfa/verify',
    payload: { mfa_token: mfaToken, code: await nextTotpToken(secret) },
  });
  expect(verified.statusCode).toBe(200);
  return verified.json<{ access_token: string }>().access_token;
}

/** A staff account on a genuinely MFA-backed session — what `isStaff` needs. */
async function staffAccount(role: string): Promise<Account> {
  const base = await registerAndVerify();
  const secret = await enrolMfa(await plainLogin(base.email));
  await exec('UPDATE users SET role = $2 WHERE id = $1::uuid', [base.id, role]);
  return { ...base, token: await mfaLogin(base.email, secret) };
}

async function userAccount(): Promise<Account> {
  const base = await registerAndVerify();
  return { ...base, token: await plainLogin(base.email) };
}

// ---------------------------------------------------------------------------
// Multipart bodies, built by hand (no extra dependency for a 20-line format)
// ---------------------------------------------------------------------------

const BOUNDARY = '----brewculttestboundary8f3a';

interface UploadPart {
  name: string;
  value?: string;
  filename?: string;
  contentType?: string;
  data?: Buffer;
}

function multipart(parts: UploadPart[]): { body: Buffer; headers: Record<string, string> } {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n`, 'latin1'));
    if (part.data) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename ?? 'upload.bin'}"\r\n` +
            `Content-Type: ${part.contentType ?? 'application/octet-stream'}\r\n\r\n`,
          'latin1',
        ),
      );
      chunks.push(part.data);
    } else {
      chunks.push(
        Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n`, 'latin1'),
      );
      chunks.push(Buffer.from(part.value ?? '', 'utf8'));
    }
    chunks.push(Buffer.from('\r\n', 'latin1'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`, 'latin1'));
  const body = Buffer.concat(chunks);
  return {
    body,
    headers: {
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      'content-length': String(body.length),
    },
  };
}

interface UploadOptions {
  token?: string;
  kind?: string;
  filename?: string;
  /** The lie the client tells about the content — always ignored by the API. */
  contentType?: string;
  /** Send `kind` as a form field instead of a query parameter. */
  kindAsField?: boolean;
}

const upload = (data: Buffer, options: UploadOptions = {}) => {
  const parts: UploadPart[] = [];
  if (options.kindAsField && options.kind) parts.push({ name: 'kind', value: options.kind });
  parts.push({
    name: 'file',
    data,
    filename: options.filename ?? 'upload.jpg',
    contentType: options.contentType ?? 'image/jpeg',
  });
  const { body, headers } = multipart(parts);
  const query = options.kind && !options.kindAsField ? `?kind=${options.kind}` : '';
  return app.inject({
    method: 'POST',
    url: `/v1/media${query}`,
    headers: { ...headers, ...(options.token ? bearer(options.token) : {}) },
    payload: body,
  });
};

// ---------------------------------------------------------------------------
// Image fixtures
// ---------------------------------------------------------------------------

const solid = (w: number, h: number, tint = 40) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 80, b: tint } } });

const png = (w = 640, h = 480, tint = 40): Promise<Buffer> => solid(w, h, tint).png().toBuffer();
const jpeg = (w = 640, h = 480): Promise<Buffer> => solid(w, h).jpeg().toBuffer();

const jpegWithGps = (): Promise<Buffer> =>
  solid(900, 700)
    .withExif({
      IFD0: { Make: 'BrewCult', Model: 'KitchenCam' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '51/1 30/1 0/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '0/1 7/1 0/1',
      },
    })
    .jpeg()
    .toBuffer();

/** Same explicit TIFF walk as the unit suite — see the note there. */
function exifHasGps(exif: Buffer | undefined): { present: boolean; gps: boolean } {
  if (!exif || exif.length < 16) return { present: false, gps: false };
  const tiff = exif.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? 6 : 0;
  const order = exif.subarray(tiff, tiff + 2).toString('latin1');
  if (order !== 'II' && order !== 'MM') return { present: false, gps: false };
  const le = order === 'II';
  const u16 = (o: number): number => (le ? exif.readUInt16LE(o) : exif.readUInt16BE(o));
  const u32 = (o: number): number => (le ? exif.readUInt32LE(o) : exif.readUInt32BE(o));
  const ifd0 = tiff + u32(tiff + 4);
  const tags: number[] = [];
  for (let i = 0; i < u16(ifd0); i += 1) tags.push(u16(ifd0 + 2 + i * 12));
  return { present: true, gps: tags.includes(0x8825) };
}

const storedBytes = (dto: MediaDto): Buffer => {
  const key = dto.url.replace('https://media.brewcult.test/brewcult-media/', '');
  const object = storage.objects.get(key);
  expect(object, `object ${key} should exist in storage`).toBeDefined();
  return object!.body;
};

const mediaCount = async (): Promise<number> => {
  const { rows } = await exec<{ n: string }>('SELECT count(*)::text AS n FROM media');
  return Number(rows[0]!.n);
};

// ---------------------------------------------------------------------------

let owner: Account;
let stranger: Account;
let staff: Account;
/** Holds the `editor` ROLE but signed in WITHOUT MFA — the crucial 403 case. */
let editorNoMfa: Account;
let roasterId: string;
let coffeeId: string;

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

  storage = memoryStorage();

  app = Fastify({ logger: false });
  registerErrorHandler(app);
  await registerIdentityRoutes(app);
  await registerMediaRoutes(app, { storage });
  await app.ready();

  owner = await userAccount();
  stranger = await userAccount();
  staff = await staffAccount('editor');
  editorNoMfa = await userAccount();
  await exec('UPDATE users SET role = $2 WHERE id = $1::uuid', [editorNoMfa.id, 'editor']);
  editorNoMfa.token = await plainLogin(editorNoMfa.email);

  const roaster = await exec<{ id: string }>(
    `INSERT INTO roasters (name, slug) VALUES ('Test Roasters', 'test-roasters')
     RETURNING id::text AS id`,
  );
  roasterId = roaster.rows[0]!.id;
  const coffee = await exec<{ id: string }>(
    `INSERT INTO coffee_products (roaster_id, name, slug, roast_level, intended_use)
     VALUES ($1::uuid, 'Test Blend', 'test-blend', 'medium', 'filter')
     RETURNING id::text AS id`,
    [roasterId],
  );
  coffeeId = coffee.rows[0]!.id;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await holder.db?.close();
  setIdentityMailer(null);
});

// ===========================================================================
describe('harness / migration 0008', () => {
  it('creates the media table with the documented vocabularies', async () => {
    const { rows } = await exec<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'media' ORDER BY ordinal_position`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(
      expect.arrayContaining([
        'id',
        'owner_id',
        'kind',
        'storage_key',
        'mime_type',
        'byte_size',
        'width',
        'height',
        'checksum_sha256',
        'status',
        'created_at',
        'updated_at',
      ]),
    );

    // The TypeScript vocabularies and the CHECK constraints must not drift.
    const constraint = await exec<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'media'::regclass AND conname LIKE '%kind%check'`,
    );
    const def = constraint.rows.map((r) => r.def).join(' ');
    for (const kind of MEDIA_KINDS) expect(def).toContain(`'${kind}'`);
    expect(MEDIA_STATUSES).toEqual(['pending', 'ready', 'failed', 'deleted']);
  });

  it('lands the FK 0006 deferred and the four attachment columns', async () => {
    const fk = await exec<{ conname: string }>(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'brew_sessions'::regclass AND contype = 'f'
          AND conname = 'brew_sessions_photo_media_id_fkey'`,
    );
    expect(fk.rows).toHaveLength(1);

    for (const [table, column] of [
      ['users', 'avatar_media_id'],
      ['coffee_products', 'image_media_id'],
      ['equipment_models', 'image_media_id'],
      ['roasters', 'image_media_id'],
    ] as const) {
      const { rows } = await exec(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = $1 AND column_name = $2`,
        [table, column],
      );
      expect(rows, `${table}.${column}`).toHaveLength(1);
    }
  });

  it('refuses a ready row with no dimensions (media_ready_is_decoded)', async () => {
    await expect(
      exec(
        `INSERT INTO media (owner_id, kind, storage_key, mime_type, byte_size, checksum_sha256, status)
         VALUES ($1::uuid, 'brew_photo', 'k/undecoded.webp', 'image/webp', 10, repeat('a', 64), 'ready')`,
        [owner.id],
      ),
    ).rejects.toThrow(/media_ready_is_decoded/);
  });
});

// ===========================================================================
describe('POST /v1/media — authentication and authorization', () => {
  it('401s an anonymous upload', async () => {
    const res = await upload(await jpeg(), { kind: 'brew_photo' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('unauthorized');
  });

  it('403s a non-staff user uploading catalog imagery', async () => {
    const res = await upload(await jpeg(), { kind: 'coffee_image', token: owner.token });
    expect(res.statusCode).toBe(403);
  });

  it('accepts a catalogue SUGGESTION photo from an ordinary account', async () => {
    // The distinction that cost a 403 in production: 'equipment_image' is the
    // picture on a public catalogue page and stays editorial; the photo somebody
    // attaches to a suggestion is their own evidence for a reviewer.
    const res = await upload(await jpeg(), { kind: 'equipment_submission', token: owner.token });
    expect(res.statusCode).toBe(201);

    const { rows } = await exec<{ owner_id: string | null }>(
      'SELECT owner_id::text AS owner_id FROM media WHERE id = $1::uuid',
      [res.json<MediaDto>().id],
    );
    // Personal media, so account deletion takes it with them.
    expect(rows[0]!.owner_id).toBe(owner.id);
  });

  it('still refuses catalogue imagery from that same account', async () => {
    const res = await upload(await jpeg(), { kind: 'equipment_image', token: owner.token });
    expect(res.statusCode).toBe(403);
  });

  it('403s a staff-ROLE user whose session is not MFA-backed', async () => {
    // `isStaff` requires role AND mfa. This is the case that proves the gate is
    // not merely a role comparison.
    const res = await upload(await jpeg(), { kind: 'coffee_image', token: editorNoMfa.token });
    expect(res.statusCode).toBe(403);
  });

  it('accepts catalog imagery from an MFA-backed editor', async () => {
    const res = await upload(await jpeg(), { kind: 'coffee_image', token: staff.token });
    expect(res.statusCode).toBe(201);
    // Platform content: no owner, provenance recorded separately.
    const { rows } = await exec<{ owner_id: string | null; uploaded_by: string }>(
      'SELECT owner_id::text AS owner_id, uploaded_by::text AS uploaded_by FROM media WHERE id = $1::uuid',
      [res.json<MediaDto>().id],
    );
    expect(rows[0]!.owner_id).toBeNull();
    expect(rows[0]!.uploaded_by).toBe(staff.id);
  });
});

// ===========================================================================
describe('POST /v1/media — the pipeline (EF §3.5)', () => {
  it('THE SNIFFING TEST: a PNG named .jpg and declared image/jpeg is accepted as a PNG', async () => {
    const res = await upload(await png(500, 400), {
      kind: 'brew_photo',
      token: owner.token,
      filename: 'definitely-a-photo.jpg',
      contentType: 'image/jpeg',
    });
    expect(res.statusCode).toBe(201);

    const dto = res.json<MediaDto>();
    // Neither the extension nor the declared type is echoed anywhere: what we
    // store is our own encoder's output.
    expect(dto.mime_type).toBe('image/webp');
    expect(dto.width).toBe(500);
    expect(dto.height).toBe(400);
    expect(dto.url.startsWith('https://media.brewcult.test/brewcult-media/')).toBe(true);
    expect(dto.thumbnail_url).toBeTruthy();
    // The stored bytes are a real WebP, whatever the request claimed.
    expect(storedBytes(dto).subarray(8, 12).toString('latin1')).toBe('WEBP');
  });

  it('accepts `kind` as a multipart field as well as a query parameter', async () => {
    const res = await upload(await png(200, 200), {
      kind: 'brew_photo',
      token: owner.token,
      kindAsField: true,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<MediaDto>().kind).toBe('brew_photo');
  });

  it('THE POLYGLOT TEST (rejected variant): a GIF with an appended payload never reaches storage', async () => {
    const before = await mediaCount();
    const objectsBefore = storage.objects.size;

    const gif = Buffer.concat([
      Buffer.from([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff,
        0xff, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02,
        0x02, 0x44, 0x01, 0x00, 0x3b,
      ]),
      Buffer.from('PK<script>alert(document.cookie)</script>', 'latin1'),
    ]);

    const res = await upload(gif, {
      kind: 'brew_photo',
      token: owner.token,
      filename: 'cute.png',
      contentType: 'image/png',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/GIF/);
    // "never persist a rejected byte": no row, no object.
    expect(await mediaCount()).toBe(before);
    expect(storage.objects.size).toBe(objectsBefore);
  });

  it('THE POLYGLOT TEST (re-encoded variant): a PNG with an appended payload is stored without it', async () => {
    const payload = Buffer.from('<script>fetch("https://evil.example")</script>', 'latin1');
    const polyglot = Buffer.concat([await png(300, 300), payload]);

    const res = await upload(polyglot, { kind: 'brew_photo', token: owner.token });
    expect(res.statusCode).toBe(201);

    const dto = res.json<MediaDto>();
    const stored = storedBytes(dto);
    expect(stored.includes(payload)).toBe(false);
    expect(stored.includes(Buffer.from('<script', 'latin1'))).toBe(false);
    // And the thumbnail too — a derivative is not a place to leak the original.
    const thumbKey = dto.thumbnail_url!.replace('https://media.brewcult.test/brewcult-media/', '');
    expect(storage.objects.get(thumbKey)!.body.includes(payload)).toBe(false);
  });

  it('THE PRIVACY TEST: an uploaded JPEG with EXIF GPS is stored with no EXIF at all', async () => {
    const source = await jpegWithGps();
    // Prove the fixture really carries GPS before trusting the assertion below.
    const beforeMeta = await sharp(source).metadata();
    expect(exifHasGps(beforeMeta.exif)).toEqual({ present: true, gps: true });

    const res = await upload(source, { kind: 'brew_photo', token: owner.token });
    expect(res.statusCode).toBe(201);

    const dto = res.json<MediaDto>();
    const stored = storedBytes(dto);
    const afterMeta = await sharp(stored).metadata();

    expect(exifHasGps(afterMeta.exif)).toEqual({ present: false, gps: false });
    expect(stored.includes(Buffer.from('51/1', 'latin1'))).toBe(false);
    expect(stored.includes(Buffer.from('KitchenCam', 'latin1'))).toBe(false);
    expect(stored.includes(Buffer.from('Exif', 'latin1'))).toBe(false);
  });

  it('rejects a PDF and an SVG (SVG is not on the allowlist — it is script-capable)', async () => {
    const pdf = await upload(Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n', 'latin1'), {
      kind: 'brew_photo',
      token: owner.token,
      filename: 'menu.pdf',
      contentType: 'application/pdf',
    });
    expect(pdf.statusCode).toBe(400);
    expect(pdf.json().message).toMatch(/PDF/);

    const svg = await upload(
      Buffer.from(
        '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        'utf8',
      ),
      {
        kind: 'roaster_logo',
        token: staff.token,
        filename: 'logo.svg',
        contentType: 'image/svg+xml',
      },
    );
    expect(svg.statusCode).toBe(400);
    expect(svg.json().message).toMatch(/SVG/);
  });

  it('rejects a file that only pretends to be an image', async () => {
    const res = await upload(Buffer.alloc(2048, 0x7a), {
      kind: 'brew_photo',
      token: owner.token,
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an oversize upload at the parser (5 MB cap)', async () => {
    // Just under the fast Content-Length pre-check, so the PARSER's own limit
    // is what fires. Nothing is buffered past the cap.
    const big = Buffer.concat([await jpeg(64, 64), Buffer.alloc(5_400_000, 0x00)]);
    const res = await upload(big, { kind: 'brew_photo', token: owner.token });
    expect(res.statusCode).toBe(413);
    expect(res.json().message).toMatch(/5 MB/);
  });

  it('rejects an oversize upload at the Content-Length pre-check', async () => {
    const huge = Buffer.concat([await jpeg(64, 64), Buffer.alloc(8_000_000, 0x00)]);
    const res = await upload(huge, { kind: 'brew_photo', token: owner.token });
    expect(res.statusCode).toBe(413);
  });

  it('requires a kind and refuses an unknown one', async () => {
    const missing = await upload(await png(80, 80), { token: owner.token });
    expect(missing.statusCode).toBe(400);

    const bogus = await upload(await png(80, 80), { token: owner.token, kind: 'passport_scan' });
    // Rejected by the query schema before the body is read.
    expect(bogus.statusCode).toBe(400);
  });
});

// ===========================================================================
describe('quota (429)', () => {
  it('refuses a further upload once the rolling-window count is spent', async () => {
    const hoarder = await userAccount();

    // The ceiling is reached in SQL rather than by uploading 50 real images:
    // the quota is computed from the table, so seeding the table exercises the
    // same code path 50 uploads would have — without 50 decodes.
    for (let i = 0; i < QUOTA_MAX_UPLOADS; i += 1) {
      await exec(
        `INSERT INTO media (owner_id, uploaded_by, kind, storage_key, mime_type, byte_size,
                            width, height, checksum_sha256, status)
         VALUES ($1::uuid, $1::uuid, 'brew_photo', $2, 'image/webp', 1024, 10, 10, repeat('b', 64), 'ready')`,
        [hoarder.id, `brew_photo/seed/${hoarder.id}-${i}.webp`],
      );
    }

    const res = await upload(await png(100, 100), { kind: 'brew_photo', token: hoarder.token });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe('rate_limited');
    // Friendly, and it says when it frees up.
    expect(res.json().message).toMatch(/daily limit/i);

    // A different account is unaffected — the limit is per-account.
    const other = await upload(await png(100, 100), { kind: 'brew_photo', token: stranger.token });
    expect(other.statusCode).toBe(201);
  });
});

// ===========================================================================
describe('GET /v1/media/:id', () => {
  it('lets the owner read their own unattached brew photo', async () => {
    const created = (await upload(await png(150, 150), { kind: 'brew_photo', token: owner.token }))
      .json<MediaDto>();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/media/${created.id}`,
      headers: bearer(owner.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<MediaDto>().url).toBe(created.url);
  });

  it('THE IDOR TEST (read): another user cannot read my private brew photo', async () => {
    const mine = (await upload(await png(150, 150), { kind: 'brew_photo', token: owner.token }))
      .json<MediaDto>();

    const theirs = await app.inject({
      method: 'GET',
      url: `/v1/media/${mine.id}`,
      headers: bearer(stranger.token),
    });
    expect(theirs.statusCode).toBe(403);

    const anon = await app.inject({ method: 'GET', url: `/v1/media/${mine.id}` });
    expect(anon.statusCode).toBe(401);
  });

  it('serves media attached to a public entity to anonymous callers', async () => {
    const logo = (await upload(await jpeg(300, 300), { kind: 'roaster_logo', token: staff.token }))
      .json<MediaDto>();

    // Not public yet — nothing points at it.
    expect((await app.inject({ method: 'GET', url: `/v1/media/${logo.id}` })).statusCode).toBe(401);

    const attached = await app.inject({
      method: 'PUT',
      url: '/v1/admin/media/attach',
      headers: bearer(staff.token),
      payload: { media_id: logo.id, target_type: 'roaster', target_id: roasterId },
    });
    expect(attached.statusCode).toBe(200);

    const anon = await app.inject({ method: 'GET', url: `/v1/media/${logo.id}` });
    expect(anon.statusCode).toBe(200);
    expect(anon.json<MediaDto>().url).toBe(logo.url);
  });

  it('404s an unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/media/11111111-2222-3333-4444-555555555555',
      headers: bearer(owner.token),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ===========================================================================
describe('DELETE /v1/media/:id', () => {
  it('THE IDOR TEST (delete): another user cannot delete my media', async () => {
    const mine = (await upload(await png(160, 160), { kind: 'brew_photo', token: owner.token }))
      .json<MediaDto>();

    const attempt = await app.inject({
      method: 'DELETE',
      url: `/v1/media/${mine.id}`,
      headers: bearer(stranger.token),
    });
    expect(attempt.statusCode).toBe(403);

    // Still there, still ready, bytes still in storage.
    const { rows } = await exec<{ status: string }>('SELECT status FROM media WHERE id = $1::uuid', [
      mine.id,
    ]);
    expect(rows[0]!.status).toBe('ready');
    expect(storedBytes(mine).length).toBeGreaterThan(0);
  });

  it('lets the owner delete: objects removed, row soft-deleted, event audited', async () => {
    const mine = (await upload(await png(170, 170), { kind: 'brew_photo', token: owner.token }))
      .json<MediaDto>();
    const key = mine.url.replace('https://media.brewcult.test/brewcult-media/', '');
    const thumbKey = mine.thumbnail_url!.replace('https://media.brewcult.test/brewcult-media/', '');

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/media/${mine.id}`,
      headers: bearer(owner.token),
    });
    expect(res.statusCode).toBe(200);

    expect(storage.objects.has(key)).toBe(false);
    expect(storage.objects.has(thumbKey)).toBe(false);

    const { rows } = await exec<{ status: string }>('SELECT status FROM media WHERE id = $1::uuid', [
      mine.id,
    ]);
    expect(rows[0]!.status).toBe('deleted');

    const audit = await exec<{ action: string }>(
      `SELECT action FROM audit_log WHERE target_id = $1 AND action = 'media.deleted'`,
      [mine.id],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('lets staff delete another user’s media', async () => {
    const mine = (await upload(await png(180, 180), { kind: 'brew_photo', token: owner.token }))
      .json<MediaDto>();
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/media/${mine.id}`,
      headers: bearer(staff.token),
    });
    expect(res.statusCode).toBe(200);
  });
});

// ===========================================================================
describe('PUT /v1/users/me/avatar', () => {
  it('sets the avatar and retires the previous one', async () => {
    const first = (await upload(await png(220, 220), { kind: 'avatar', token: owner.token }))
      .json<MediaDto>();
    const second = (await upload(await png(240, 240, 90), { kind: 'avatar', token: owner.token }))
      .json<MediaDto>();

    const set = await app.inject({
      method: 'PUT',
      url: '/v1/users/me/avatar',
      headers: bearer(owner.token),
      payload: { media_id: first.id },
    });
    expect(set.statusCode).toBe(200);

    let row = await exec<{ avatar_media_id: string | null }>(
      'SELECT avatar_media_id::text AS avatar_media_id FROM users WHERE id = $1::uuid',
      [owner.id],
    );
    expect(row.rows[0]!.avatar_media_id).toBe(first.id);

    const replaced = await app.inject({
      method: 'PUT',
      url: '/v1/users/me/avatar',
      headers: bearer(owner.token),
      payload: { media_id: second.id },
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json<{ previous_media_id: string }>().previous_media_id).toBe(first.id);

    row = await exec<{ avatar_media_id: string | null }>(
      'SELECT avatar_media_id::text AS avatar_media_id FROM users WHERE id = $1::uuid',
      [owner.id],
    );
    expect(row.rows[0]!.avatar_media_id).toBe(second.id);

    // The old avatar is gone from storage and marked deleted.
    const oldKey = first.url.replace('https://media.brewcult.test/brewcult-media/', '');
    expect(storage.objects.has(oldKey)).toBe(false);
    const old = await exec<{ status: string }>('SELECT status FROM media WHERE id = $1::uuid', [
      first.id,
    ]);
    expect(old.rows[0]!.status).toBe('deleted');
  });

  it('refuses another user’s media and the wrong kind', async () => {
    const mine = (await upload(await png(210, 210), { kind: 'avatar', token: owner.token }))
      .json<MediaDto>();
    const notAnAvatar = (
      await upload(await png(210, 210), { kind: 'brew_photo', token: stranger.token })
    ).json<MediaDto>();

    const idor = await app.inject({
      method: 'PUT',
      url: '/v1/users/me/avatar',
      headers: bearer(stranger.token),
      payload: { media_id: mine.id },
    });
    expect(idor.statusCode).toBe(403);

    const wrongKind = await app.inject({
      method: 'PUT',
      url: '/v1/users/me/avatar',
      headers: bearer(stranger.token),
      payload: { media_id: notAnAvatar.id },
    });
    expect(wrongKind.statusCode).toBe(400);
  });

  it('401s anonymously and clears with media_id: null', async () => {
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/v1/users/me/avatar',
          payload: { media_id: null },
        })
      ).statusCode,
    ).toBe(401);

    const cleared = await app.inject({
      method: 'PUT',
      url: '/v1/users/me/avatar',
      headers: bearer(owner.token),
      payload: { media_id: null },
    });
    expect(cleared.statusCode).toBe(200);
    const { rows } = await exec<{ avatar_media_id: string | null }>(
      'SELECT avatar_media_id::text AS avatar_media_id FROM users WHERE id = $1::uuid',
      [owner.id],
    );
    expect(rows[0]!.avatar_media_id).toBeNull();
  });
});

// ===========================================================================
describe('PUT /v1/admin/media/attach', () => {
  it('attaches a coffee image as staff, and writes an audit record', async () => {
    const image = (await upload(await jpeg(400, 400), { kind: 'coffee_image', token: staff.token }))
      .json<MediaDto>();

    const res = await app.inject({
      method: 'PUT',
      url: '/v1/admin/media/attach',
      headers: bearer(staff.token),
      payload: { media_id: image.id, target_type: 'coffee_product', target_id: coffeeId },
    });
    expect(res.statusCode).toBe(200);

    const { rows } = await exec<{ image_media_id: string | null }>(
      'SELECT image_media_id::text AS image_media_id FROM coffee_products WHERE id = $1::uuid',
      [coffeeId],
    );
    expect(rows[0]!.image_media_id).toBe(image.id);

    const audit = await exec<{ actor_id: string; payload: { media_id: string } }>(
      `SELECT actor_id::text AS actor_id, payload FROM audit_log
        WHERE action = 'media.attached' AND target_id = $1`,
      [coffeeId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.actor_id).toBe(staff.id);
    expect(audit.rows[0]!.payload.media_id).toBe(image.id);
  });

  it('403s a non-staff caller and a staff-role session without MFA', async () => {
    const image = (await upload(await jpeg(400, 400), { kind: 'coffee_image', token: staff.token }))
      .json<MediaDto>();

    for (const token of [owner.token, editorNoMfa.token]) {
      const res = await app.inject({
        method: 'PUT',
        url: '/v1/admin/media/attach',
        headers: bearer(token),
        payload: { media_id: image.id, target_type: 'coffee_product', target_id: coffeeId },
      });
      expect(res.statusCode).toBe(403);
    }

    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/v1/admin/media/attach',
          payload: { media_id: image.id, target_type: 'coffee_product', target_id: coffeeId },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('refuses a media kind that does not match the target, and an unknown target', async () => {
    const avatar = (await upload(await png(200, 200), { kind: 'avatar', token: owner.token }))
      .json<MediaDto>();

    const mismatch = await app.inject({
      method: 'PUT',
      url: '/v1/admin/media/attach',
      headers: bearer(staff.token),
      payload: { media_id: avatar.id, target_type: 'coffee_product', target_id: coffeeId },
    });
    expect(mismatch.statusCode).toBe(400);

    const missingTarget = await app.inject({
      method: 'PUT',
      url: '/v1/admin/media/attach',
      headers: bearer(staff.token),
      payload: {
        media_id: null,
        target_type: 'roaster',
        target_id: '11111111-2222-3333-4444-555555555555',
      },
    });
    expect(missingTarget.statusCode).toBe(404);
  });
});

// ===========================================================================
describe('assertMediaUsable — the seam brewing calls', () => {
  it('accepts the owner’s ready brew photo and rejects everything else', async () => {
    const mine = (await upload(await png(260, 260), { kind: 'brew_photo', token: owner.token }))
      .json<MediaDto>();

    await expect(
      assertMediaUsable(defaultMediaDb, mine.id, owner.id, 'brew_photo'),
    ).resolves.toMatchObject({ id: mine.id, kind: 'brew_photo' });

    // THE IDOR the FK cannot stop: a valid media id that is not yours.
    await expect(
      assertMediaUsable(defaultMediaDb, mine.id, stranger.id, 'brew_photo'),
    ).rejects.toMatchObject({ statusCode: 403 });

    // Wrong kind.
    const avatar = (await upload(await png(120, 120), { kind: 'avatar', token: owner.token }))
      .json<MediaDto>();
    await expect(
      assertMediaUsable(defaultMediaDb, avatar.id, owner.id, 'brew_photo'),
    ).rejects.toMatchObject({ statusCode: 400 });

    // Unknown id.
    await expect(
      assertMediaUsable(
        defaultMediaDb,
        '11111111-2222-3333-4444-555555555555',
        owner.id,
        'brew_photo',
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('accepts a bare exec function as well as a `.query` seam', async () => {
    const mine = (await upload(await png(130, 130), { kind: 'brew_photo', token: owner.token }))
      .json<MediaDto>();
    await expect(
      assertMediaUsable(exec, mine.id, owner.id, 'brew_photo'),
    ).resolves.toMatchObject({ id: mine.id });
  });

  it('deleting media detaches it from a brew session (0008 FK + soft-delete)', async () => {
    const photo = (await upload(await png(140, 140), { kind: 'brew_photo', token: owner.token }))
      .json<MediaDto>();

    await exec(
      `INSERT INTO brew_sessions (id, user_id, grind, params, source, photo_media_id, body_hash)
       VALUES (gen_random_uuid(), $1::uuid,
               '{"category":"medium"}'::jsonb,
               '{"method":"filter"}'::jsonb,
               'new', $2::uuid, 'hash-1')`,
      [owner.id, photo.id],
    );

    await app.inject({
      method: 'DELETE',
      url: `/v1/media/${photo.id}`,
      headers: bearer(owner.token),
    });

    const { rows } = await exec<{ n: string }>(
      'SELECT count(*)::text AS n FROM brew_sessions WHERE photo_media_id = $1::uuid',
      [photo.id],
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('lists a user’s storage keys for the account-deletion job', async () => {
    const keys = await listOwnedStorageKeys(defaultMediaDb, owner.id);
    expect(keys.length).toBeGreaterThan(0);
    // Every SELF-SERVE kind, which is the point: personal media leaves with the
    // person. Catalogue imagery has no owner and therefore never appears here.
    for (const key of keys) expect(key).toMatch(/^(avatar|brew_photo|equipment_submission)\//);
    expect(keys.some((key) => key.startsWith('equipment_submission/'))).toBe(true);
  });
});
