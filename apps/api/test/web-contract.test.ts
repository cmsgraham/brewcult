/**
 * THE CONTRACT CHECK.
 *
 * Every path the web client calls must exist as a route on the real API.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Five defects reached production behind entirely green test suites:
 *
 *   - the AI chat body asserted {messages:[...]}, the shape the API rejects
 *   - the Google button asserted /api/v1/auth/google, which 404s
 *   - the refresh cookie asserted path /v1/auth, which no browser ever sends
 *   - three admin suites stubbed ME = '/api/me', a route that does not exist
 *
 * None of those were careless. Each was written from the same assumption as the
 * code it tested, and the web suite stubs `fetch` — so it can only ever confirm
 * what the client BELIEVES. It is structurally incapable of noticing that the
 * server disagrees. More unit tests on either side would not have helped;
 * something had to compare the two.
 *
 * This test boots the ACTUAL Fastify app, collects the routes it really
 * registers, then reads the web source and extracts every '/api/...' literal it
 * contains. A path in the client with no matching route on the server fails the
 * build. All five defects above would have failed here immediately.
 *
 * ── WHY IT READS SOURCE TEXT RATHER THAN IMPORTING ──────────────────────────
 * The alternative is a shared manifest of paths that both sides import — but
 * then the manifest is a third thing to keep in sync, and a client calling a
 * path it did not take from the manifest is invisible again. Reading the text
 * catches the literal wherever somebody actually typed it.
 *
 * Comments are stripped first: this file would otherwise flag the explanatory
 * notes in api.ts describing the very bugs it exists to prevent.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/db.js', () => ({
  query: async () => ({ rows: [] }),
  transaction: async (fn: (c: unknown) => Promise<unknown>) =>
    fn({ query: async () => ({ rows: [] }) }),
  getPool: () => ({ query: async () => ({ rows: [] }) }),
  closePool: async () => {},
}));

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const WEB_ROOTS = ['apps/web/lib', 'apps/web/components', 'apps/web/app'];

/**
 * Paths the client references that the API deliberately does not serve.
 *
 * Every entry needs a reason. An allowlist without reasons becomes the place
 * failures go to be forgotten, which would make this test worse than useless.
 */
const KNOWN_ABSENT = new Map<string, string>([
  [
    '/api/me',
    'Legacy fallback. mfa-client tries /api/v1/users/me first and only falls back ' +
      'to this on a 404, for interim API builds. Harmless dead code; removing it is safe ' +
      'once no such build exists.',
  ],
  [
    '/api/client-config',
    'Same shape: client-config.ts tries /api/v1/client-config first and falls back once.',
  ],
  [
    '/api/me/export',
    'Data export is genuinely NOT BUILT. The UI reports the 404 as "coming soon", which ' +
      'is honest. When the endpoint lands, delete this entry and the test starts guarding it.',
  ],

  // --- base prefixes, never requested on their own -------------------------
  // These are constants concatenated with a sub-path (`${ADMIN_BASE}/users`).
  // The scanner sees the literal but no request is ever made to it. They stay
  // listed rather than silently skipped so that the staleness check below still
  // watches them: if one ever becomes a real route, this entry is flagged.
  ['/api/v1/admin', 'ADMIN_BASE in admin-client.ts — always used as `${ADMIN_BASE}/...`.'],
  ['/api/v1/auth', 'AUTH_BASE in mfa-client.ts — always used as `${AUTH_BASE}/...`.'],
  [
    '/api/v1/auth/password',
    'A prefix in NO_REFRESH_PATHS (api.ts), matched with startsWith so it covers ' +
      '/password/forgot and /password/reset. Not a request target.',
  ],
]);

/** Strips comments so explanatory prose about a wrong path is not read as one. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** `${expr}` -> `:param`; drops query strings; trims trailing slash. */
function normalise(path: string): string {
  return path
    .replace(/\$\{[^}]*\}/g, ':param')
    .split('?')[0]!
    .replace(/\/+$/, '');
}

/** Filters out prose fragments that merely look like paths. */
function isPlausiblePath(path: string): boolean {
  if (path.includes('...') || path.includes('*')) return false;
  // Anything left with a non-path character is a sentence, not a URL.
  return /^\/api(\/[A-Za-z0-9:_.~-]+)*$/.test(path);
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      out.push(...(await walk(full)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

interface ClientPath {
  path: string;
  file: string;
}

async function collectClientPaths(): Promise<ClientPath[]> {
  const literal = /['"`](\/api\/[^'"`\s]*)['"`]/g;
  const seen = new Map<string, string>();

  for (const root of WEB_ROOTS) {
    for (const file of await walk(join(repoRoot, root))) {
      // Test files describe wrong paths on purpose; they are not the client.
      if (/[\\/]test[\\/]/.test(file) || /\.test\.tsx?$/.test(file)) continue;
      const source = stripComments(await readFile(file, 'utf8'));
      for (const match of source.matchAll(literal)) {
        const path = normalise(match[1]!);
        if (!isPlausiblePath(path)) continue;
        if (!seen.has(path)) seen.set(path, file.slice(repoRoot.length));
      }
    }
  }
  return [...seen].map(([path, file]) => ({ path, file }));
}

/**
 * Does the API have a route here?
 *
 * Asks by INJECTING a request rather than by parsing a route table: that is the
 * faithful question, it exercises real Fastify routing including prefixes, and
 * it cannot drift from however the app happens to compose itself.
 *
 * Fastify answers a missing route with its own envelope
 * ({"error":"Not Found","message":"Route GET:/x not found"}), which is
 * distinguishable from OUR 404s ({"error":"not_found"} from the error handler).
 * That distinction matters: /v1/coffees/:slug legitimately 404s for an unknown
 * slug, and reading that as a missing route would make this test cry wolf on a
 * perfectly good path.
 */
const PROBE_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;

async function routeExists(instance: FastifyInstance, url: string): Promise<boolean> {
  // `:param` is a pattern, not a value — give it something a route can bind.
  const concrete = url.replace(/:param/g, 'contract-probe');
  for (const method of PROBE_METHODS) {
    const res = await instance.inject({ method, url: concrete });
    let body: { error?: string; message?: string } = {};
    try {
      body = res.json() as typeof body;
    } catch {
      return true; // a non-JSON reply is still a reply: something handled it
    }
    const routeMissing =
      res.statusCode === 404 &&
      body.error === 'Not Found' &&
      (body.message ?? '').startsWith('Route ');
    if (!routeMissing) return true;
  }
  return false;
}

let app: FastifyInstance;

beforeAll(async () => {
  // Google routes register only when credentials exist, and the client links to
  // them unconditionally — without these the test would report a false failure
  // on a correct path.
  process.env.GOOGLE_CLIENT_ID = 'contract-test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'contract-test-client-secret';

  // buildApp(), not a hand-assembled list of modules. Re-registering by hand
  // would miss anything app.ts mounts inline — /healthz and /v1/client-config
  // are both defined there — and a contract test blind to part of the real
  // surface reports false failures on correct paths. Testing the actual
  // composition root is the whole point.
  const { buildApp } = await import('../src/app.js');
  app = await buildApp();
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('web → api contract', () => {
  it('the harness itself works — a known route answers and a nonsense one does not', async () => {
    // Without this, a boot that registered nothing would make every assertion
    // below pass vacuously.
    expect(await routeExists(app, '/healthz')).toBe(true);
    expect(await routeExists(app, '/definitely-not-a-route-xyz')).toBe(false);
  });

  it('EVERY path the web client calls exists on the API', async () => {
    const clientPaths = await collectClientPaths();
    expect(clientPaths.length).toBeGreaterThan(15); // the scanner found something

    const missing: string[] = [];
    for (const { path, file } of clientPaths) {
      if (KNOWN_ABSENT.has(path)) continue;
      // Caddy and the Next dev rewrite both strip `/api` before Fastify sees
      // the request, so the API's own routes never carry that prefix.
      const apiPath = path.replace(/^\/api/, '');
      if (!(await routeExists(app, apiPath))) {
        missing.push(`${path}  (${file})  ->  API has no route ${apiPath}`);
      }
    }

    const report = [
      'The web client calls paths the API does not serve:',
      ...missing,
      'Either the client path is wrong, or the route moved. Remember that the',
      'browser sees /api/... while the API routes without that prefix',
      '(engineering_foundations 9.1).',
    ].join(' | ');

    expect(missing, report).toEqual([]);
  });

  it('every documented exception is still genuinely absent', async () => {
    // If an allowlisted path starts existing, the entry is stale and the path
    // should be guarded like every other. Allowlists rot silently otherwise.
    const stale: string[] = [];
    for (const [path, reason] of KNOWN_ABSENT) {
      if (await routeExists(app, path.replace(/^\/api/, ''))) {
        stale.push(`${path} now EXISTS — remove it from KNOWN_ABSENT (${reason})`);
      }
    }
    expect(stale).toEqual([]);
  });

  it('the OAuth entry points are unversioned, and stay that way', async () => {
    // Registered in Google's console and matched byte for byte, so a `/v1`
    // sweep must never capture them. This is the bug that 404'd sign-in.
    expect(await routeExists(app, '/auth/google')).toBe(true);
    expect(await routeExists(app, '/auth/google/callback')).toBe(true);
    expect(await routeExists(app, '/v1/auth/google')).toBe(false);
  });

  it('the current-user route is under /v1/users, not /me', async () => {
    // The bare /me assumption cost an entire session of "login not working".
    expect(await routeExists(app, '/v1/users/me')).toBe(true);
    expect(await routeExists(app, '/me')).toBe(false);
  });
});
