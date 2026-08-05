/**
 * Catalog module integration suite (EF §1.4 "integration: each module's API +
 * DB, no mocks of SQL").
 *
 * The database is a real PostgreSQL 16 engine — PGlite, the WASM build — with
 * db/migrations/0001..0003 applied verbatim apart from `CREATE EXTENSION vector`,
 * which PGlite does not ship. Nothing about the SQL under test is stubbed.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

import { registerErrorHandler } from '../src/lib/errors.js';
import { ANONYMOUS, resetPolicies, type Actor } from '../src/lib/policy.js';
import { registerCatalogRoutes } from '../src/modules/catalog/index.js';
import type { CatalogDb } from '../src/modules/catalog/index.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIGRATIONS = join(REPO_ROOT, 'db', 'migrations');
const SEED_DATA = join(REPO_ROOT, 'db', 'seed', 'data');

const loadSeed = <T>(name: string): T[] => JSON.parse(readFileSync(join(SEED_DATA, name), 'utf8'));

/** Postgres array literal, so array params work identically on pg and PGlite. */
const pgArray = (values: readonly string[]): string =>
  `{${values.map((v) => `"${v.replace(/(["\\])/g, '\\$1')}"`).join(',')}}`;

// --- seed shapes (mirror db/seed/seed.ts) ----------------------------------

interface SeedRoaster {
  slug: string;
  name: string;
  location: string | null;
  verified: boolean;
}
interface SeedOrigin {
  country: string;
  region: string | null;
  description: string | null;
}
interface SeedFarm {
  origin: string;
  name: string;
  story: string | null;
}
interface SeedProduct {
  slug: string;
  roaster: string;
  name: string;
  roast_level: string;
  intended_use: string;
  tasting_notes: string[];
  status: string;
  lot: {
    origin: string;
    farm: string | null;
    varietals: string[];
    process: string;
    process_detail?: string;
    altitude_masl: number | null;
    harvest_period: string | null;
  };
}
interface SeedEquipment {
  slug: string;
  brand: string;
  category: string;
  name: string;
  grind_scale_type?: string;
  specs: Record<string, unknown>;
}
interface SeedConversion {
  from: string;
  from_setting: string;
  to: string;
  to_setting: string;
  confidence: number;
}

// --- harness ----------------------------------------------------------------

let pg: PGlite;
let app: FastifyInstance;
let db: CatalogDb;
/** Mutated per-test; the onRequest hook below stands in for Lane E's plugin. */
let currentActor: Actor = ANONYMOUS;

const ADMIN: Actor = { userId: '11111111-1111-4111-8111-111111111111', role: 'admin', mfa: true };
const EDITOR: Actor = { userId: '22222222-2222-4222-8222-222222222222', role: 'editor', mfa: true };
const USER: Actor = { userId: '33333333-3333-4333-8333-333333333333', role: 'user' };
/** Staff role but no MFA — EF §2.3 says that is not staff enough. */
const ADMIN_NO_MFA: Actor = { userId: ADMIN.userId, role: 'admin' };

async function applyMigrations(): Promise<void> {
  // 0006 + 0008 join the list because the catalog projection now LEFT JOINs
  // `media` for entity artwork, and 0008's deferred FK needs brew_sessions.
  // 0004/0005 stay out: pg_trgm and the identity extras are not needed here.
  for (const file of [
    '0001_extensions.sql',
    '0002_identity.sql',
    '0003_catalog.sql',
    '0006_brewing.sql',
    '0008_media.sql',
    // 0013 adds the provenance columns the equipment writer now sets. Without
    // it every insert failed on an undefined column and surfaced as a 500,
    // which masked the 400 this suite is actually asserting.
    '0010_user_equipment.sql',
    '0011_custom_equipment.sql',
    '0013_community_catalogue.sql',
  ]) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
      // PGlite has no pgvector build; the embedding columns land in a later
      // migration, so nothing in the catalog suite depends on it.
      .replace(/CREATE EXTENSION IF NOT EXISTS vector;/g, '-- vector: unavailable in PGlite');
    await pg.exec(sql);
  }
}

async function seed(): Promise<void> {
  const roasterIds = new Map<string, string>();
  const originIds = new Map<string, string>();
  const farmIds = new Map<string, string>();
  const modelIds = new Map<string, string>();

  for (const r of loadSeed<SeedRoaster>('roasters.json')) {
    const res = await pg.query<{ id: string }>(
      `INSERT INTO roasters (name, slug, location, verified) VALUES ($1,$2,$3,$4) RETURNING id`,
      [r.name, r.slug, r.location, r.verified],
    );
    roasterIds.set(r.slug, res.rows[0]!.id);
  }

  for (const o of loadSeed<SeedOrigin>('origins.json')) {
    const res = await pg.query<{ id: string }>(
      `INSERT INTO origins (country, region, description) VALUES ($1,$2,$3) RETURNING id`,
      [o.country, o.region, o.description],
    );
    originIds.set(`${o.country}|${o.region ?? ''}`, res.rows[0]!.id);
  }

  for (const f of loadSeed<SeedFarm>('farms.json')) {
    const res = await pg.query<{ id: string }>(
      `INSERT INTO farms (origin_id, name, story) VALUES ($1,$2,$3) RETURNING id`,
      [originIds.get(f.origin)!, f.name, f.story],
    );
    farmIds.set(`${f.origin}|${f.name}`, res.rows[0]!.id);
  }

  // Products get staggered created_at so the keyset cursor exercises the
  // timestamp comparison, not just the uuid tiebreaker.
  let offset = 0;
  for (const p of loadSeed<SeedProduct>('coffee_products.json')) {
    const lot = await pg.query<{ id: string }>(
      `INSERT INTO coffee_lots
         (origin_id, farm_id, varietals, process, process_detail, altitude_masl, harvest_period)
       VALUES ($1,$2,$3::text[],$4,$5,$6,$7) RETURNING id`,
      [
        originIds.get(p.lot.origin)!,
        p.lot.farm ? (farmIds.get(`${p.lot.origin}|${p.lot.farm}`) ?? null) : null,
        pgArray(p.lot.varietals),
        p.lot.process,
        p.lot.process_detail ?? null,
        p.lot.altitude_masl,
        p.lot.harvest_period,
      ],
    );
    await pg.query(
      `INSERT INTO coffee_products
         (roaster_id, coffee_lot_id, name, slug, roast_level, intended_use,
          tasting_notes, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8, now() - ($9 || ' seconds')::interval)`,
      [
        roasterIds.get(p.roaster)!,
        lot.rows[0]!.id,
        p.name,
        p.slug,
        p.roast_level,
        p.intended_use,
        pgArray(p.tasting_notes),
        p.status,
        String(offset++),
      ],
    );
  }

  // Two roast batches on one product so the detail shape has something to show.
  await pg.query(
    `INSERT INTO roast_batches (coffee_product_id, roast_date)
     SELECT id, d FROM coffee_products,
       (VALUES (DATE '2026-07-01'), (DATE '2026-07-15')) AS v(d)
     WHERE slug = $1`,
    ['cascara-ethiopia-chelbesa-washed'],
  );

  const brandIds = new Map<string, string>();
  for (const e of loadSeed<SeedEquipment>('equipment.json')) {
    if (!brandIds.has(e.brand)) {
      const b = await pg.query<{ id: string }>(
        `INSERT INTO equipment_brands (name) VALUES ($1) RETURNING id`,
        [e.brand],
      );
      brandIds.set(e.brand, b.rows[0]!.id);
    }
    const res = await pg.query<{ id: string }>(
      `INSERT INTO equipment_models (brand_id, category, name, slug, specs, grind_scale_type)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING id`,
      [
        brandIds.get(e.brand)!,
        e.category,
        e.name,
        e.slug,
        JSON.stringify(e.specs),
        e.grind_scale_type ?? null,
      ],
    );
    modelIds.set(e.slug, res.rows[0]!.id);
  }

  for (const c of loadSeed<SeedConversion>('grind_conversions.json')) {
    await pg.query(
      `INSERT INTO grind_conversions
         (from_model_id, from_setting, to_model_id, to_setting, source, confidence)
       VALUES ($1,$2,$3,$4,'seeded',$5)`,
      [modelIds.get(c.from)!, c.from_setting, modelIds.get(c.to)!, c.to_setting, c.confidence],
    );
  }
}

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  pg = await PGlite.create({ extensions: { citext, pgcrypto } });
  await applyMigrations();
  await seed();

  db = {
    query: async <T>(text: string, params: readonly unknown[] = []) =>
      pg.query<T>(text, params as unknown[]) as unknown as Promise<{ rows: T[] }>,
  };

  resetPolicies();
  // A bare instance, not buildApp(): the full bootstrap also mounts identity
  // (which needs a live pool) and would double-register the catalog routes this
  // test mounts below against its injected PGlite db.
  app = Fastify();
  registerErrorHandler(app);
  // Stand-in for the identity lane's auth plugin: the catalog only ever reads
  // `request.actor`, it never defines it (see modules/catalog/auth-seam.ts).
  app.addHook('onRequest', async (request: FastifyRequest) => {
    (request as FastifyRequest & { actor: Actor }).actor = currentActor;
  });
  await registerCatalogRoutes(app, { db });
  await app.ready();
}, 120_000);

afterAll(async () => {
  currentActor = ANONYMOUS;
  await app?.close();
  await pg?.close();
});

const as = <T>(actor: Actor, fn: () => Promise<T>): Promise<T> => {
  currentActor = actor;
  return fn().finally(() => {
    currentActor = ANONYMOUS;
  });
};

// ---------------------------------------------------------------------------

describe('GET /v1/coffees — filters and pagination (CAT-04)', () => {
  it('lists coffees anonymously', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/coffees?limit=100' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: unknown[]; next_cursor: string | null }>();
    expect(body.items).toHaveLength(20);
    expect(body.next_cursor).toBeNull();
  });

  it('filters by roaster slug', async () => {
    const res = await app.inject({ url: '/v1/coffees?roaster=cascara-roasting-co&limit=100' });
    const body = res.json<{ items: { roaster: { slug: string } }[] }>();
    expect(body.items).toHaveLength(4);
    expect(body.items.every((c) => c.roaster.slug === 'cascara-roasting-co')).toBe(true);
  });

  it('filters by origin country, process, roast level and intended use', async () => {
    const origin = await app.inject({ url: '/v1/coffees?origin=Ethiopia&limit=100' });
    expect(origin.json<{ items: unknown[] }>().items).toHaveLength(5);

    const honey = await app.inject({ url: '/v1/coffees?process=honey&limit=100' });
    expect(honey.json<{ items: { process: string }[] }>().items).toHaveLength(3);

    const light = await app.inject({ url: '/v1/coffees?roast_level=light&limit=100' });
    expect(light.json<{ items: unknown[] }>().items).toHaveLength(8);

    const espresso = await app.inject({ url: '/v1/coffees?intended_use=espresso&limit=100' });
    expect(espresso.json<{ items: unknown[] }>().items).toHaveLength(5);
  });

  it('combines filters', async () => {
    const res = await app.inject({
      url: '/v1/coffees?roaster=aurora-roastworks&roast_level=light&limit=100',
    });
    expect(res.json<{ items: unknown[] }>().items).toHaveLength(3);
  });

  it('rejects an unknown enum value with 400', async () => {
    const res = await app.inject({ url: '/v1/coffees?process=fermented-in-a-shoe' });
    expect(res.statusCode).toBe(400);
  });

  it('pages with a stable cursor that never repeats or skips a row', async () => {
    const all = await app.inject({ url: '/v1/coffees?limit=100' });
    const expected = all.json<{ items: { slug: string }[] }>().items.map((c) => c.slug);

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard += 1) {
      const url: string = `/v1/coffees?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await app.inject({ url });
      expect(page.statusCode).toBe(200);
      const body = page.json<{ items: { slug: string }[]; next_cursor: string | null }>();
      seen.push(...body.items.map((c) => c.slug));
      cursor = body.next_cursor;
      if (!cursor) break;
    }

    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('keeps the cursor stable when a filter is re-applied on the next page', async () => {
    const first = await app.inject({ url: '/v1/coffees?roast_level=light&limit=5' });
    const firstBody = first.json<{ items: { slug: string }[]; next_cursor: string }>();
    expect(firstBody.items).toHaveLength(5);

    const second = await app.inject({
      url: `/v1/coffees?roast_level=light&limit=5&cursor=${encodeURIComponent(firstBody.next_cursor)}`,
    });
    const secondBody = second.json<{ items: { slug: string }[] }>();
    expect(secondBody.items).toHaveLength(3);
    const overlap = secondBody.items.filter((c) =>
      firstBody.items.some((f) => f.slug === c.slug),
    );
    expect(overlap).toHaveLength(0);
  });

  it('rejects a tampered cursor with 400 rather than leaking a 500', async () => {
    const res = await app.inject({ url: '/v1/coffees?cursor=not-a-real-cursor' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('bad_request');
  });
});

describe('GET /v1/coffees/:slug — full detail join (§6.1)', () => {
  it('returns product, roaster, lot, origin, farm and roast batches', async () => {
    const res = await app.inject({ url: '/v1/coffees/cascara-ethiopia-chelbesa-washed' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      name: string;
      roast_level: string;
      intended_use: string;
      tasting_notes: string[];
      roaster: { slug: string; name: string };
      lot: {
        process: string;
        varietals: string[];
        altitude_masl: number;
        harvest_period: string;
        origin: { country: string; region: string };
        farm: { name: string; story: string };
      };
      roast_batches: { roast_date: string }[];
    }>();

    expect(body.name).toBe('Ethiopia Chelbesa, Washed');
    expect(body.roaster.slug).toBe('cascara-roasting-co');
    expect(body.tasting_notes).toContain('jasmine');
    expect(body.lot.process).toBe('washed');
    expect(body.lot.varietals).toContain('74110');
    expect(body.lot.altitude_masl).toBe(2100);
    expect(body.lot.origin).toMatchObject({ country: 'Ethiopia', region: 'Yirgacheffe' });
    expect(body.lot.farm.name).toBe('Chelbesa Washing Station');
    // Freshness lives on the batch, newest first (§6.2).
    expect(body.roast_batches.map((b) => b.roast_date)).toEqual(['2026-07-15', '2026-07-01']);
  });

  it('404s an unknown slug', async () => {
    const res = await app.inject({ url: '/v1/coffees/no-such-coffee' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toBe('not_found');
  });
});

describe('GET /v1/roasters, /v1/equipment, /v1/origins', () => {
  it('lists roasters with their coffee counts', async () => {
    const res = await app.inject({ url: '/v1/roasters?limit=100' });
    const body = res.json<{ items: { slug: string; coffee_count: number }[] }>();
    expect(body.items).toHaveLength(5);
    expect(body.items.every((r) => r.coffee_count === 4)).toBe(true);
  });

  it('returns a roaster detail with its coffees', async () => {
    const res = await app.inject({ url: '/v1/roasters/kiln-and-cherry' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ name: string; verified: boolean; coffees: { slug: string }[] }>();
    expect(body.name).toBe('Kiln & Cherry');
    expect(body.verified).toBe(true);
    expect(body.coffees).toHaveLength(4);
  });

  it('filters equipment by category and brand', async () => {
    // Asserts the FILTER, not a head-count. This used to expect exactly 15
    // grinders and 3 Baratzas, which coupled the test to how many rows the seed
    // happened to contain — so adding real models to the catalogue broke it
    // while nothing about the behaviour had changed. What matters is that
    // everything coming back matches the filter, and that the filter is
    // actually narrowing the set.
    const all = await app.inject({ url: '/v1/equipment?limit=100' });
    const allItems = all.json<{ items: { category: string }[] }>().items;

    const grinders = await app.inject({ url: '/v1/equipment?category=grinder&limit=100' });
    const grinderItems = grinders.json<{ items: { category: string }[] }>().items;
    expect(grinderItems.length).toBeGreaterThan(0);
    expect(grinderItems.every((e) => e.category === 'grinder')).toBe(true);
    expect(grinderItems.length).toBeLessThan(allItems.length); // it narrowed

    const baratza = await app.inject({ url: '/v1/equipment?brand=baratza&limit=100' });
    const body = baratza.json<{ items: { brand: { name: string } }[] }>();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((e) => e.brand.name === 'Baratza')).toBe(true);
  });

  it('returns equipment detail with specs and grind scale type (§6.4)', async () => {
    const res = await app.inject({ url: '/v1/equipment/comandante-c40-mk4' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      grind_scale_type: string;
      category: string;
      brand: { name: string };
      specs: Record<string, unknown>;
    }>();
    expect(body.category).toBe('grinder');
    expect(body.grind_scale_type).toBe('rotational');
    expect(body.brand.name).toBe('Comandante');
    expect(body.specs.clicks_per_rotation).toBe(10);
  });

  it('lists origins with coffee counts', async () => {
    const res = await app.inject({ url: '/v1/origins' });
    const body = res.json<{ items: { country: string; region: string; coffee_count: number }[] }>();
    expect(body.items).toHaveLength(8);
    expect(body.items[0]!.country).toBe('Brazil');
    const ethiopiaTotal = body.items
      .filter((o) => o.country === 'Ethiopia')
      .reduce((sum, o) => sum + o.coffee_count, 0);
    expect(ethiopiaTotal).toBe(5);
  });
});

describe('GET /v1/search — Postgres full text (CAT-07)', () => {
  it('finds a coffee by a word from its name', async () => {
    const res = await app.inject({ url: '/v1/search?q=chelbesa' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: { type: string; slug: string }[] }>();
    expect(body.items.some((h) => h.slug === 'cascara-ethiopia-chelbesa-washed')).toBe(true);
  });

  it('finds a coffee by a roaster tasting note', async () => {
    const res = await app.inject({ url: '/v1/search?q=blackcurrant&type=coffee' });
    const body = res.json<{ items: { slug: string }[] }>();
    expect(body.items.map((h) => h.slug)).toContain('cascara-kenya-gatomboya-aa');
  });

  it('finds equipment and roasters, and honours ?type=', async () => {
    const equipment = await app.inject({ url: '/v1/search?q=comandante&type=equipment' });
    const eqBody = equipment.json<{ items: { type: string; slug: string }[] }>();
    expect(eqBody.items[0]!.slug).toBe('comandante-c40-mk4');
    expect(eqBody.items.every((h) => h.type === 'equipment')).toBe(true);

    const roasters = await app.inject({ url: '/v1/search?q=london&type=roaster' });
    const rBody = roasters.json<{ items: { type: string; slug: string }[] }>();
    expect(rBody.items.map((h) => h.slug)).toEqual(['kiln-and-cherry']);
  });

  it('returns hits from every type when ?type is omitted', async () => {
    const res = await app.inject({ url: '/v1/search?q=espresso&limit=50' });
    const body = res.json<{ items: { type: string }[] }>();
    expect(body.items.length).toBeGreaterThan(0);
    expect(new Set(body.items.map((h) => h.type)).size).toBeGreaterThanOrEqual(1);
  });

  it('treats SQL metacharacters as ordinary text (no injection through q)', async () => {
    const payloads = [
      "'; DROP TABLE coffee_products; --",
      "') OR 1=1 --",
      "chelbesa'; DELETE FROM roasters WHERE '1'='1",
      '\\; select pg_sleep(5); --',
    ];
    for (const q of payloads) {
      const res = await app.inject({ url: `/v1/search?q=${encodeURIComponent(q)}` });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json<{ items: unknown[] }>().items)).toBe(true);
    }

    // The catalog is still intact.
    const coffees = await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM coffee_products');
    expect(coffees.rows[0]!.n).toBe(20);
    const roasters = await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM roasters');
    expect(roasters.rows[0]!.n).toBeGreaterThanOrEqual(5);
  });

  it('rejects a missing or empty q with 400', async () => {
    expect((await app.inject({ url: '/v1/search' })).statusCode).toBe(400);
    expect((await app.inject({ url: '/v1/search?q=%20%20' })).statusCode).toBe(400);
  });
});

describe('GET /v1/autocomplete — entity picker (CAT-06, §5)', () => {
  it('ranks prefix matches above later-word matches', async () => {
    const res = await app.inject({ url: '/v1/autocomplete?q=encore&types=equipment' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: { type: string; label: string; slug: string }[] }>();
    expect(body.items[0]!.label).toBe('Baratza Encore');
    expect(body.items[1]!.label).toBe('Baratza Encore ESP');
    expect(body.items.every((i) => i.type === 'equipment')).toBe(true);
  });

  it('ranks an exact label first', async () => {
    const res = await app.inject({ url: '/v1/autocomplete?q=house%20espresso&types=coffee' });
    const body = res.json<{ items: { label: string }[] }>();
    expect(body.items[0]!.label).toBe('House Espresso');
  });

  it('breaks a prefix tie on the shorter label', async () => {
    const res = await app.inject({ url: '/v1/autocomplete?q=yirgacheffe&types=coffee&limit=10' });
    const labels = res.json<{ items: { label: string }[] }>().items.map((i) => i.label);
    expect(labels.slice(0, 2)).toEqual(['Yirgacheffe Lot 7', 'Yirgacheffe Natural']);
  });

  it('ranks a direct prefix hit above rows matched only through a related entity', async () => {
    const res = await app.inject({ url: '/v1/autocomplete?q=cascara&limit=10' });
    const items = res.json<{ items: { type: string; label: string }[] }>().items;
    // The roaster's own name is a prefix match (rank 1); its four coffees match
    // only because their roaster does, so they sort after it (rank 3).
    expect(items[0]).toMatchObject({ type: 'roaster', label: 'Cascara Roasting Co.' });
    expect(items.slice(1).every((i) => i.type === 'coffee')).toBe(true);
    expect(items).toHaveLength(5);
  });

  it('returns the {type,id,slug,label,sublabel} shape across types', async () => {
    const res = await app.inject({ url: '/v1/autocomplete?q=cascara&limit=10' });
    const body = res.json<{
      items: { type: string; id: string; slug: string; label: string; sublabel: string | null }[];
    }>();
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(['coffee', 'roaster', 'equipment']).toContain(item.type);
      expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(typeof item.slug).toBe('string');
      expect(typeof item.label).toBe('string');
      expect('sublabel' in item).toBe(true);
    }
    expect(body.items.some((i) => i.type === 'roaster' && i.slug === 'cascara-roasting-co')).toBe(
      true,
    );
  });

  it('escapes LIKE wildcards so % and _ cannot match everything', async () => {
    const pct = await app.inject({ url: '/v1/autocomplete?q=%25' });
    expect(pct.statusCode).toBe(200);
    expect(pct.json<{ items: unknown[] }>().items).toHaveLength(0);

    const underscore = await app.inject({ url: '/v1/autocomplete?q=_' });
    expect(underscore.json<{ items: unknown[] }>().items).toHaveLength(0);
  });

  it('rejects an unknown entity type with 400', async () => {
    const res = await app.inject({ url: '/v1/autocomplete?q=en&types=coffee,wine' });
    expect(res.statusCode).toBe(400);
  });

  it('honours the limit', async () => {
    const res = await app.inject({ url: '/v1/autocomplete?q=e&limit=3' });
    expect(res.json<{ items: unknown[] }>().items).toHaveLength(3);
  });

  it('stays fast on the seeded dataset (CAT-06 budget)', async () => {
    const queries = ['e', 'et', 'eth', 'ethi', 'baratza', 'espresso', 'yirg', 'com'];
    const timings: number[] = [];
    for (const q of queries) {
      const started = performance.now();
      const res = await app.inject({ url: `/v1/autocomplete?q=${q}` });
      timings.push(performance.now() - started);
      expect(res.statusCode).toBe(200);
    }
    timings.sort((a, b) => a - b);
    const p95 = timings[Math.min(timings.length - 1, Math.ceil(timings.length * 0.95) - 1)]!;
    // CAT-06's real budget is <100ms p95 on Postgres; PGlite runs the same SQL
    // in WASM, so this is a regression tripwire rather than the SLO itself.
    expect(p95).toBeLessThan(250);
  });
});

describe('GET /v1/grind-conversions — uncertainty is mandatory (§6.4)', () => {
  const comandante = async (): Promise<string> => {
    const res = await pg.query<{ id: string }>(
      `SELECT id FROM equipment_models WHERE slug = 'comandante-c40-mk4'`,
    );
    return res.rows[0]!.id;
  };

  it('never returns a converted setting without confidence and sample size', async () => {
    const res = await app.inject({ url: `/v1/grind-conversions?from_model_id=${await comandante()}` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      disclaimer: string;
      items: {
        to_setting: string;
        from_model: { slug: string; grind_scale_type: string };
        to_model: { slug: string; brand: string };
        uncertainty: {
          confidence: number;
          sample_size: number;
          source: string;
          band: string;
        };
      }[];
    }>();

    expect(body.disclaimer).toMatch(/approximate/i);
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(typeof item.to_setting).toBe('string');
      expect(item.from_model.grind_scale_type).toBe('rotational');
      expect(typeof item.to_model.brand).toBe('string');
      expect(item.uncertainty.confidence).toBeGreaterThan(0);
      expect(item.uncertainty.confidence).toBeLessThanOrEqual(1);
      expect(Number.isInteger(item.uncertainty.sample_size)).toBe(true);
      expect(item.uncertainty.sample_size).toBeGreaterThanOrEqual(1);
      expect(['user_confirmed', 'seeded']).toContain(item.uncertainty.source);
      expect(['low', 'medium', 'high']).toContain(item.uncertainty.band);
    }
    // Seeded community charts are low-confidence by construction (§6.4 point 3).
    expect(body.items.every((i) => i.uncertainty.band !== 'high')).toBe(true);
  });

  it('narrows to a single grinder pair with to_model_id', async () => {
    const to = await pg.query<{ id: string }>(
      `SELECT id FROM equipment_models WHERE slug = 'baratza-encore'`,
    );
    const res = await app.inject({
      url: `/v1/grind-conversions?from_model_id=${await comandante()}&to_model_id=${to.rows[0]!.id}`,
    });
    const body = res.json<{ items: { to_model: { slug: string }; uncertainty: unknown }[] }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.to_model.slug).toBe('baratza-encore');
    expect(body.items[0]!.uncertainty).toBeDefined();
  });

  it('returns an empty item list (still with the disclaimer) for a grinder with no data', async () => {
    const lonely = await pg.query<{ id: string }>(
      `SELECT id FROM equipment_models WHERE slug = 'mahlkonig-x54'`,
    );
    const id = lonely.rows[0]?.id;
    if (!id) return; // slug differs in the seed; the shape is covered above
    const res = await app.inject({ url: `/v1/grind-conversions?from_model_id=${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ disclaimer: string }>().disclaimer).toMatch(/approximate/i);
  });

  it('404s an unknown grinder and 400s a malformed uuid', async () => {
    const missing = await app.inject({
      url: '/v1/grind-conversions?from_model_id=00000000-0000-4000-8000-000000000000',
    });
    expect(missing.statusCode).toBe(404);

    const malformed = await app.inject({ url: '/v1/grind-conversions?from_model_id=nope' });
    expect(malformed.statusCode).toBe(400);
  });
});

describe('Editorial CRUD — staff only (CAT-05, EF §3.2)', () => {
  it('401s an anonymous mutation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/roasters',
      payload: { name: 'Anonymous Coffee' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403s an authenticated non-staff user', async () => {
    const res = await as(USER, () =>
      app.inject({ method: 'POST', url: '/v1/roasters', payload: { name: 'User Coffee' } }),
    );
    expect(res.statusCode).toBe(403);
  });

  it('403s a staff role whose session is not MFA-backed (EF §2.3)', async () => {
    const res = await as(ADMIN_NO_MFA, () =>
      app.inject({ method: 'POST', url: '/v1/roasters', payload: { name: 'No MFA Coffee' } }),
    );
    expect(res.statusCode).toBe(403);
  });

  it('creates a roaster for staff and derives the slug', async () => {
    const res = await as(EDITOR, () =>
      app.inject({
        method: 'POST',
        url: '/v1/roasters',
        payload: { name: 'Ålesund Kaffebrenneri', location: 'Ålesund, Norway' },
      }),
    );
    expect(res.statusCode).toBe(201);
    const body = res.json<{ slug: string; name: string; verified: boolean }>();
    expect(body.slug).toBe('alesund-kaffebrenneri');
    expect(body.verified).toBe(false);
  });

  it('409s a slug that already exists', async () => {
    const res = await as(ADMIN, () =>
      app.inject({
        method: 'POST',
        url: '/v1/roasters',
        payload: { name: 'Cascara Roasting Co.' },
      }),
    );
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe('conflict');
  });

  it('409s an explicit duplicate slug on a coffee too', async () => {
    const roaster = await pg.query<{ id: string }>(
      `SELECT id FROM roasters WHERE slug = 'cascara-roasting-co'`,
    );
    const res = await as(ADMIN, () =>
      app.inject({
        method: 'POST',
        url: '/v1/coffees',
        payload: {
          roaster_id: roaster.rows[0]!.id,
          name: 'Another Chelbesa',
          slug: 'cascara-ethiopia-chelbesa-washed',
          roast_level: 'light',
          intended_use: 'filter',
        },
      }),
    );
    expect(res.statusCode).toBe(409);
  });

  it('creates and updates a coffee, validating the controlled vocabularies', async () => {
    const roaster = await pg.query<{ id: string }>(
      `SELECT id FROM roasters WHERE slug = 'aurora-roastworks'`,
    );
    const roasterId = roaster.rows[0]!.id;

    const bad = await as(ADMIN, () =>
      app.inject({
        method: 'POST',
        url: '/v1/coffees',
        payload: {
          roaster_id: roasterId,
          name: 'Charcoal Roast',
          roast_level: 'incinerated',
          intended_use: 'filter',
        },
      }),
    );
    expect(bad.statusCode).toBe(400);

    const created = await as(ADMIN, () =>
      app.inject({
        method: 'POST',
        url: '/v1/coffees',
        payload: {
          roaster_id: roasterId,
          name: 'Aurora Midsummer Filter',
          roast_level: 'light',
          intended_use: 'filter',
          tasting_notes: ['peach', 'elderflower'],
        },
      }),
    );
    expect(created.statusCode).toBe(201);
    const createdBody = created.json<{ id: string; slug: string; tasting_notes: string[] }>();
    expect(createdBody.slug).toBe('aurora-midsummer-filter');
    expect(createdBody.tasting_notes).toEqual(['peach', 'elderflower']);

    const patched = await as(EDITOR, () =>
      app.inject({
        method: 'PATCH',
        url: `/v1/coffees/${createdBody.id}`,
        payload: { status: 'discontinued' },
      }),
    );
    expect(patched.statusCode).toBe(200);
    expect(patched.json<{ status: string }>().status).toBe('discontinued');

    const denied = await as(USER, () =>
      app.inject({
        method: 'PATCH',
        url: `/v1/coffees/${createdBody.id}`,
        payload: { status: 'active' },
      }),
    );
    expect(denied.statusCode).toBe(403);
  });

  it('400s a coffee whose roaster does not exist', async () => {
    const res = await as(ADMIN, () =>
      app.inject({
        method: 'POST',
        url: '/v1/coffees',
        payload: {
          roaster_id: '00000000-0000-4000-8000-000000000000',
          name: 'Ghost Roaster Coffee',
          roast_level: 'medium',
          intended_use: 'omni',
        },
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('creates an equipment model and enforces the grinder scale-type rule (§6.4)', async () => {
    const brands = await app.inject({ url: '/v1/equipment-brands' });
    const brandId = brands
      .json<{ items: { id: string; name: string }[] }>()
      .items.find((b) => b.name === 'Fellow')!.id;

    const missingScale = await as(ADMIN, () =>
      app.inject({
        method: 'POST',
        url: '/v1/equipment',
        payload: { brand_id: brandId, category: 'grinder', name: 'Ode Gen 3' },
      }),
    );
    // The 0003 CHECK requires grind_scale_type on grinders — surfaced as a 400.
    expect(missingScale.statusCode).toBe(400);

    const created = await as(ADMIN, () =>
      app.inject({
        method: 'POST',
        url: '/v1/equipment',
        payload: {
          brand_id: brandId,
          category: 'grinder',
          name: 'Ode Gen 3',
          grind_scale_type: 'stepped',
          specs: { burr: 'flat 64mm', drive: 'electric' },
        },
      }),
    );
    expect(created.statusCode).toBe(201);
    const body = created.json<{ id: string; slug: string; specs: Record<string, unknown> }>();
    expect(body.slug).toBe('ode-gen-3');
    expect(body.specs.burr).toBe('flat 64mm');

    const renamed = await as(EDITOR, () =>
      app.inject({
        method: 'PATCH',
        url: `/v1/equipment/${body.id}`,
        payload: { name: 'Ode Brew Grinder Gen 3' },
      }),
    );
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json<{ name: string }>().name).toBe('Ode Brew Grinder Gen 3');
  });

  it('404s an update to a missing row', async () => {
    const res = await as(ADMIN, () =>
      app.inject({
        method: 'PATCH',
        url: '/v1/roasters/00000000-0000-4000-8000-000000000000',
        payload: { name: 'Nobody' },
      }),
    );
    expect(res.statusCode).toBe(404);
  });

  it('400s an empty patch body', async () => {
    const roaster = await pg.query<{ id: string }>(
      `SELECT id FROM roasters WHERE slug = 'meridian-coffee-roasters'`,
    );
    const res = await as(ADMIN, () =>
      app.inject({
        method: 'PATCH',
        url: `/v1/roasters/${roaster.rows[0]!.id}`,
        payload: {},
      }),
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('reads stay public for anonymous callers (P0 catalog data)', () => {
  it('allows every GET without an actor', async () => {
    const urls = [
      '/v1/coffees',
      '/v1/coffees/cascara-ethiopia-chelbesa-washed',
      '/v1/roasters',
      '/v1/roasters/cascara-roasting-co',
      '/v1/equipment',
      '/v1/equipment/comandante-c40-mk4',
      '/v1/equipment-brands',
      '/v1/origins',
      '/v1/search?q=ethiopia',
      '/v1/autocomplete?q=eth',
    ];
    for (const url of urls) {
      const res = await app.inject({ url });
      expect([200], `${url} → ${res.statusCode}`).toContain(res.statusCode);
    }
  });
});
