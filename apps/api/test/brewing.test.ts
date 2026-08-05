/**
 * Brewing module integration suite (EF §1.4 "integration: each module's API +
 * DB, no mocks of SQL").
 *
 * The database is a real PostgreSQL 16 engine — PGlite, the WASM build — with
 * db/migrations/0001..0004 and 0006 applied VERBATIM apart from two extensions
 * PGlite does not ship: `vector` (0001) and `pg_trgm` (0004, along with the four
 * trigram indexes that need it). Everything this module depends on — the
 * generated `diagnosis` column, the CHECK constraints, the UNIQUE that stops
 * grind-conversion double counting, `grind_conversions.data_points` — is the
 * real thing. Nothing about the SQL under test is stubbed.
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
import { registerBrewingRoutes } from '../src/modules/brewing/index.js';
import { diagnoseTaste } from '../src/modules/brewing/index.js';
import type { BrewingDb } from '../src/modules/brewing/index.js';
import type {
  BrewPrefill,
  BrewSession,
  GrindConversionSuggestion,
  Recipe,
  SyncChangesResponse,
  SyncUpsertResult,
} from '@brewcult/shared-types';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIGRATIONS = join(REPO_ROOT, 'db', 'migrations');

let pg: PGlite;
let app: FastifyInstance;
let db: BrewingDb;
let currentActor: Actor = ANONYMOUS;

// Fixed ids keep failures readable; the v7-shaped ones stand in for the
// client-minted UUIDv7s the real logger produces (EF §2.2).
const USER_A: Actor = { userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'user' };
const USER_B: Actor = { userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', role: 'user' };

const ids = {
  coffee1: '',
  coffee2: '',
  coffee3: '',
  batch1: '',
  brewerV60: '',
  brewerAeropress: '',
  grinderOde: '',
  grinderComandante: '',
};

const uuid = (n: number, tag = '7'): string =>
  `0189${String(n).padStart(4, '0')}-0000-${tag}000-8000-${String(n).padStart(12, '0')}`;

async function applyMigrations(): Promise<void> {
  for (const file of [
    '0001_extensions.sql',
    '0002_identity.sql',
    '0003_catalog.sql',
    '0004_catalog_search_indexes.sql',
    '0006_brewing.sql',
  ]) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
      .replace(/CREATE EXTENSION IF NOT EXISTS vector;/g, '-- vector: unavailable in PGlite')
      .replace(/CREATE EXTENSION IF NOT EXISTS pg_trgm;/g, '-- pg_trgm: unavailable in PGlite')
      .replace(
        /CREATE INDEX IF NOT EXISTS \w+\n\s+ON \w+ USING gin \(lower\(name\) gin_trgm_ops\);/g,
        '-- trigram index: needs pg_trgm',
      );
    await pg.exec(sql);
  }
}

async function seed(): Promise<void> {
  for (const [actor, handle] of [
    [USER_A, 'anna'],
    [USER_B, 'ben'],
  ] as const) {
    await pg.query(`INSERT INTO users (id, handle, email) VALUES ($1::uuid, $2, $3)`, [
      actor.userId,
      handle,
      `${handle}@example.com`,
    ]);
  }

  const roaster = await pg.query<{ id: string }>(
    `INSERT INTO roasters (name, slug) VALUES ('Cascara', 'cascara') RETURNING id`,
  );
  const origin = await pg.query<{ id: string }>(
    `INSERT INTO origins (country, region) VALUES ('Ethiopia', 'Yirgacheffe') RETURNING id`,
  );
  const lot = await pg.query<{ id: string }>(
    `INSERT INTO coffee_lots (origin_id, process) VALUES ($1::uuid, 'washed') RETURNING id`,
    [origin.rows[0]!.id],
  );

  for (const [key, slug] of [
    ['coffee1', 'chelbesa'],
    ['coffee2', 'guji'],
    ['coffee3', 'sidamo'],
  ] as const) {
    const res = await pg.query<{ id: string }>(
      `INSERT INTO coffee_products (roaster_id, coffee_lot_id, name, slug, roast_level, intended_use)
       VALUES ($1::uuid, $2::uuid, $3, $4, 'light', 'filter') RETURNING id`,
      [roaster.rows[0]!.id, lot.rows[0]!.id, slug, slug],
    );
    ids[key] = res.rows[0]!.id;
  }

  const batch = await pg.query<{ id: string }>(
    `INSERT INTO roast_batches (coffee_product_id, roast_date)
     VALUES ($1::uuid, DATE '2026-07-01') RETURNING id`,
    [ids.coffee1],
  );
  ids.batch1 = batch.rows[0]!.id;

  const brand = await pg.query<{ id: string }>(
    `INSERT INTO equipment_brands (name) VALUES ('Generic') RETURNING id`,
  );
  const model = async (
    category: string,
    name: string,
    slug: string,
    scale: string | null,
  ): Promise<string> => {
    const res = await pg.query<{ id: string }>(
      `INSERT INTO equipment_models (brand_id, category, name, slug, grind_scale_type)
       VALUES ($1::uuid, $2, $3, $4, $5) RETURNING id`,
      [brand.rows[0]!.id, category, name, slug, scale],
    );
    return res.rows[0]!.id;
  };
  ids.brewerV60 = await model('brewer', 'V60', 'v60', null);
  ids.brewerAeropress = await model('brewer', 'AeroPress', 'aeropress', null);
  ids.grinderOde = await model('grinder', 'Ode Gen 2', 'ode-gen-2', 'stepped');
  ids.grinderComandante = await model('grinder', 'Comandante C40', 'comandante-c40', 'rotational');
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
  app = Fastify();
  registerErrorHandler(app);
  // Stand-in for the identity lane's auth plugin: brewing only ever reads
  // `request.actor`, exactly like the catalog suite does.
  app.addHook('onRequest', async (request: FastifyRequest) => {
    (request as FastifyRequest & { actor: Actor }).actor = currentActor;
  });
  await registerBrewingRoutes(app, { db });
  await app.ready();
}, 180_000);

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

const grind = (
  model: string | null,
  setting: string | null,
  scale: string | null,
  category = 'medium_fine',
) => ({ equipment_model_id: model, setting, scale_type: scale, category });

const filterParams = (over: Record<string, unknown> = {}) => ({
  method: 'filter',
  dose_g: 15,
  water_g: 250,
  temperature_c: 94,
  brew_time_s: 165,
  ...over,
});

const espressoParams = (over: Record<string, unknown> = {}) => ({
  method: 'espresso',
  dose_in_g: 18,
  yield_out_g: 36,
  shot_time_s: 28,
  ...over,
});

const recipeBody = (over: Record<string, unknown> = {}) => ({
  title: 'Chelbesa V60',
  coffee_product_id: ids.coffee1,
  method: 'filter',
  brewer_model_id: ids.brewerV60,
  grind: grind(ids.grinderOde, '6.5', 'stepped'),
  params: filterParams(),
  ...over,
});

const brewBody = (over: Record<string, unknown> = {}) => ({
  coffee_product_id: ids.coffee1,
  brewer_model_id: ids.brewerV60,
  grinder_model_id: ids.grinderOde,
  grind: grind(ids.grinderOde, '6.5', 'stepped'),
  params: filterParams(),
  source: 'new',
  ...over,
});

// ===========================================================================
describe('recipes — CRUD and the params discriminated union (REC-01, REC-02)', () => {
  it('creates a filter recipe, derives the ratio and stores the schema version', async () => {
    const res = await as(USER_A, () =>
      app.inject({ method: 'POST', url: '/v1/recipes', payload: recipeBody() }),
    );
    expect(res.statusCode).toBe(201);
    const recipe = res.json<Recipe>();
    expect(recipe.author_id).toBe(USER_A.userId);
    expect(recipe.params_schema_version).toBe(1);
    expect(recipe.visibility).toBe('private');
    expect(recipe.version).toBe(1);
    expect(recipe.parent_recipe_id).toBeNull();
    expect(recipe.changed_fields).toEqual([]);
    // 250 / 15 — derived, never entered (§6.3).
    expect(recipe.params).toMatchObject({ ratio: 16.67 });
  });

  it('overwrites a client-supplied ratio rather than trusting it', async () => {
    const res = await as(USER_A, () =>
      app.inject({
        method: 'POST',
        url: '/v1/recipes',
        payload: recipeBody({ params: filterParams({ ratio: 99 }) }),
      }),
    );
    expect(res.statusCode).toBe(201);
    expect(res.json<Recipe>().params).toMatchObject({ ratio: 16.67 });
  });

  it('REJECTS an espresso params body on a filter method', async () => {
    const res = await as(USER_A, () =>
      app.inject({
        method: 'POST',
        url: '/v1/recipes',
        payload: recipeBody({ method: 'filter', params: espressoParams() }),
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toMatch(/espresso/);
  });

  it('REJECTS a filter params body on an espresso method', async () => {
    const res = await as(USER_A, () =>
      app.inject({
        method: 'POST',
        url: '/v1/recipes',
        payload: recipeBody({ method: 'espresso', params: filterParams() }),
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('accepts a genuine espresso recipe (schema-ready per logger UX §8.1)', async () => {
    const res = await as(USER_A, () =>
      app.inject({
        method: 'POST',
        url: '/v1/recipes',
        payload: recipeBody({
          title: 'Guji espresso',
          method: 'espresso',
          params: espressoParams(),
          grind: grind(ids.grinderComandante, '12', 'rotational', 'fine'),
        }),
      }),
    );
    expect(res.statusCode).toBe(201);
    expect(res.json<Recipe>().params).toMatchObject({ method: 'espresso', ratio: 2 });
  });

  it('rejects params matching neither schema', async () => {
    const missingWater = await as(USER_A, () =>
      app.inject({
        method: 'POST',
        url: '/v1/recipes',
        payload: recipeBody({ params: { method: 'filter', dose_g: 15 } }),
      }),
    );
    expect(missingWater.statusCode).toBe(400);
  });

  it('keeps each branch of the union intact — no cross-contamination', async () => {
    // `oneOf` + Ajv's `removeAdditional` is the combination that could quietly
    // strip a branch's own fields. Both shapes must survive whole.
    const filter = await as(USER_A, () =>
      app.inject({
        method: 'POST',
        url: '/v1/recipes',
        payload: recipeBody({
          title: 'Pour schedule',
          params: filterParams({
            pours: [
              { at_s: 0, to_g: 45, note: 'bloom' },
              { at_s: 45, to_g: 250 },
            ],
            filter_type: 'Cafec Abaca',
          }),
        }),
      }),
    );
    expect(filter.json<Recipe>().params).toMatchObject({
      pours: [
        { at_s: 0, to_g: 45, note: 'bloom' },
        { at_s: 45, to_g: 250 },
      ],
      filter_type: 'Cafec Abaca',
    });

    const espresso = await as(USER_A, () =>
      app.inject({
        method: 'POST',
        url: '/v1/recipes',
        payload: recipeBody({
          title: 'Profiled shot',
          method: 'espresso',
          grind: grind(ids.grinderComandante, '10', 'rotational', 'fine'),
          params: espressoParams({
            pre_infusion_s: 8,
            pressure_profile: [{ at_s: 0, bar: 3 }, { at_s: 8, bar: 9 }],
            puck_prep: ['WDT', 'RDT'],
          }),
        }),
      }),
    );
    expect(espresso.json<Recipe>().params).toMatchObject({
      method: 'espresso',
      dose_in_g: 18,
      yield_out_g: 36,
      pre_infusion_s: 8,
      puck_prep: ['WDT', 'RDT'],
    });
  });

  it('strips unknown params rather than storing them (shared Ajv removeAdditional)', async () => {
    const res = await as(USER_A, () =>
      app.inject({
        method: 'POST',
        url: '/v1/recipes',
        payload: recipeBody({
          title: 'Hybrid nonsense',
          params: { method: 'filter', dose_g: 15, water_g: 250, yield_out_g: 36 },
        }),
      }),
    );
    // The app-wide Ajv config (Fastify's default `removeAdditional: true`)
    // removes unknown properties instead of 400-ing. The invariant that matters
    // holds either way: an espresso field can never reach a filter row.
    expect(res.statusCode).toBe(201);
    expect(res.json<Recipe>().params).not.toHaveProperty('yield_out_g');
  });

  it('makes a bare-number grind impossible — category is mandatory (REC-02)', async () => {
    const res = await as(USER_A, () =>
      app.inject({
        method: 'POST',
        url: '/v1/recipes',
        payload: recipeBody({
          grind: { equipment_model_id: ids.grinderOde, setting: '6.5', scale_type: 'stepped' },
        }),
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects out-of-vocabulary enums', async () => {
    const badCategory = await as(USER_A, () =>
      app.inject({
        method: 'POST',
        url: '/v1/recipes',
        payload: recipeBody({ grind: grind(null, null, null, 'chunky') }),
      }),
    );
    expect(badCategory.statusCode).toBe(400);
  });

  it('requires authentication to create', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/recipes', payload: recipeBody() });
    expect(res.statusCode).toBe(401);
  });

  it('reads, patches and soft-deletes', async () => {
    const created = await as(USER_A, () =>
      app.inject({ method: 'POST', url: '/v1/recipes', payload: recipeBody({ title: 'Lifecycle' }) }),
    );
    const id = created.json<Recipe>().id;

    const read = await as(USER_A, () => app.inject({ url: `/v1/recipes/${id}` }));
    expect(read.json<Recipe>().title).toBe('Lifecycle');

    const patched = await as(USER_A, () =>
      app.inject({ method: 'PATCH', url: `/v1/recipes/${id}`, payload: { title: 'Lifecycle v2' } }),
    );
    expect(patched.statusCode).toBe(200);
    expect(patched.json<Recipe>().title).toBe('Lifecycle v2');
    expect(patched.json<Recipe>().version).toBe(2);

    const deleted = await as(USER_A, () =>
      app.inject({ method: 'DELETE', url: `/v1/recipes/${id}` }),
    );
    expect(deleted.statusCode).toBe(204);

    const list = await as(USER_A, () => app.inject({ url: '/v1/recipes?author=me&limit=100' }));
    expect(list.json<{ items: Recipe[] }>().items.some((r) => r.id === id)).toBe(false);
  });
});

// ===========================================================================
describe('fork lineage and the changed_fields diff (REC-04, §6.6)', () => {
  let parentId = '';
  let forkId = '';

  it('forks with a real diff, a permanent parent link and the forker as author', async () => {
    const parent = await as(USER_A, () =>
      app.inject({
        method: 'POST',
        url: '/v1/recipes',
        payload: recipeBody({ title: 'Anna Chelbesa', visibility: 'public' }),
      }),
    );
    parentId = parent.json<Recipe>().id;

    const fork = await as(USER_B, () =>
      app.inject({
        method: 'POST',
        url: `/v1/recipes/${parentId}/fork`,
        payload: {
          grind: grind(ids.grinderComandante, '22', 'rotational'),
          params: filterParams({ dose_g: 16, water_g: 250 }),
        },
      }),
    );
    expect(fork.statusCode).toBe(201);
    const forked = fork.json<Recipe>();
    forkId = forked.id;

    expect(forked.parent_recipe_id).toBe(parentId);
    expect(forked.author_id).toBe(USER_B.userId);
    expect(forked.title).toBe('Anna Chelbesa'); // unchanged → not a diff entry
    // Leaf paths, sorted. `params.ratio` moved too but is derived, so excluded.
    expect(forked.changed_fields).toEqual([
      'grind.equipment_model_id',
      'grind.scale_type',
      'grind.setting',
      'params.dose_g',
    ]);
  });

  it('exposes permanent upstream attribution and the change count', async () => {
    const res = await as(USER_B, () => app.inject({ url: `/v1/recipes/${forkId}/lineage` }));
    expect(res.statusCode).toBe(200);
    const lineage = res.json<{
      parent_recipe_id: string;
      change_count: number;
      forked_from: { id: string; author_id: string; title: string };
    }>();
    expect(lineage.parent_recipe_id).toBe(parentId);
    expect(lineage.change_count).toBe(4);
    expect(lineage.forked_from.author_id).toBe(USER_A.userId);
  });

  it('records an empty diff when a fork changes nothing', async () => {
    const fork = await as(USER_B, () =>
      app.inject({ method: 'POST', url: `/v1/recipes/${parentId}/fork`, payload: {} }),
    );
    expect(fork.json<Recipe>().changed_fields).toEqual([]);
  });

  it('keeps a fork diff honest as the fork is edited', async () => {
    const patched = await as(USER_B, () =>
      app.inject({
        method: 'PATCH',
        url: `/v1/recipes/${forkId}`,
        payload: { title: 'Ben Chelbesa' },
      }),
    );
    expect(patched.json<Recipe>().changed_fields).toContain('title');
  });

  it('refuses to fork a private recipe belonging to someone else', async () => {
    const priv = await as(USER_A, () =>
      app.inject({ method: 'POST', url: '/v1/recipes', payload: recipeBody({ title: 'Secret' }) }),
    );
    const res = await as(USER_B, () =>
      app.inject({ method: 'POST', url: `/v1/recipes/${priv.json<Recipe>().id}/fork`, payload: {} }),
    );
    expect(res.statusCode).toBe(403);
  });

  it('refuses to change the method on a fork', async () => {
    const res = await as(USER_B, () =>
      app.inject({
        method: 'POST',
        url: `/v1/recipes/${parentId}/fork`,
        payload: { params: espressoParams() },
      }),
    );
    expect(res.statusCode).toBe(400);
  });
});

// ===========================================================================
describe('visibility policy — IDOR (REC-05)', () => {
  let privateId = '';
  let unlistedId = '';
  let publicId = '';

  beforeAll(async () => {
    const make = async (visibility: string): Promise<string> => {
      const res = await as(USER_A, () =>
        app.inject({
          method: 'POST',
          url: '/v1/recipes',
          payload: recipeBody({ title: `${visibility} recipe`, visibility }),
        }),
      );
      return res.json<Recipe>().id;
    };
    privateId = await make('private');
    unlistedId = await make('unlisted');
    publicId = await make('public');
  });

  it("user B cannot READ user A's private recipe", async () => {
    const res = await as(USER_B, () => app.inject({ url: `/v1/recipes/${privateId}` }));
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toBe('forbidden');
  });

  it("user B cannot UPDATE user A's private recipe (PATCH or PUT)", async () => {
    const patch = await as(USER_B, () =>
      app.inject({ method: 'PATCH', url: `/v1/recipes/${privateId}`, payload: { title: 'mine' } }),
    );
    expect(patch.statusCode).toBe(403);

    const put = await as(USER_B, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/recipes/${privateId}`,
        payload: recipeBody({ title: 'hijacked' }),
      }),
    );
    expect(put.statusCode).toBe(403);

    // ...and nothing changed.
    const check = await as(USER_A, () => app.inject({ url: `/v1/recipes/${privateId}` }));
    expect(check.json<Recipe>().title).toBe('private recipe');
    expect(check.json<Recipe>().author_id).toBe(USER_A.userId);
  });

  it("user B cannot DELETE user A's private recipe", async () => {
    const res = await as(USER_B, () =>
      app.inject({ method: 'DELETE', url: `/v1/recipes/${privateId}` }),
    );
    expect(res.statusCode).toBe(403);
  });

  it("user B cannot even UPDATE user A's PUBLIC recipe", async () => {
    const res = await as(USER_B, () =>
      app.inject({ method: 'PATCH', url: `/v1/recipes/${publicId}`, payload: { title: 'mine' } }),
    );
    expect(res.statusCode).toBe(403);
  });

  it('anonymous callers get 401 on private and 200 on public', async () => {
    expect((await app.inject({ url: `/v1/recipes/${privateId}` })).statusCode).toBe(401);
    expect((await app.inject({ url: `/v1/recipes/${publicId}` })).statusCode).toBe(200);
  });

  it('unlisted is readable by anyone holding the id, but never listed', async () => {
    const read = await as(USER_B, () => app.inject({ url: `/v1/recipes/${unlistedId}` }));
    expect(read.statusCode).toBe(200);

    const list = await as(USER_B, () => app.inject({ url: '/v1/recipes?limit=100' }));
    const listed = list.json<{ items: Recipe[] }>().items.map((r) => r.id);
    expect(listed).not.toContain(unlistedId);
    expect(listed).not.toContain(privateId);
    expect(listed).toContain(publicId);
  });

  it("user A's own list contains their private rows and none of user B's", async () => {
    const list = await as(USER_A, () => app.inject({ url: '/v1/recipes?author=me&limit=100' }));
    const items = list.json<{ items: Recipe[] }>().items;
    expect(items.map((r) => r.id)).toContain(privateId);
    expect(items.every((r) => r.author_id === USER_A.userId)).toBe(true);
  });
});

// ===========================================================================
describe('recipes — conflict-copy sync semantics (REC-07, EF §2.2)', () => {
  const id = uuid(101);
  let copyId = '';

  it('PUT creates on first write', async () => {
    const res = await as(USER_A, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/recipes/${id}`,
        payload: recipeBody({ title: 'Offline draft' }),
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json<SyncUpsertResult>()).toMatchObject({ id, applied: 'created' });
  });

  it('PUT of the same body is a noop', async () => {
    const res = await as(USER_A, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/recipes/${id}`,
        payload: recipeBody({ title: 'Offline draft' }),
      }),
    );
    expect(res.json<SyncUpsertResult>().applied).toBe('noop');
  });

  it('PUT with a matching base_version updates in place', async () => {
    const res = await as(USER_A, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/recipes/${id}`,
        payload: recipeBody({ title: 'Offline draft', base_version: 1, params: filterParams({ dose_g: 16 }) }),
      }),
    );
    expect(res.json<SyncUpsertResult>().applied).toBe('updated');
  });

  it('a STALE base_version produces a conflict copy and NEVER overwrites', async () => {
    const before = await as(USER_A, () => app.inject({ url: `/v1/recipes/${id}` }));
    const beforeRecipe = before.json<Recipe>();
    expect(beforeRecipe.version).toBe(2);

    const res = await as(USER_A, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/recipes/${id}`,
        payload: recipeBody({
          title: 'Offline draft',
          base_version: 1, // the client never saw version 2
          params: filterParams({ dose_g: 18, water_g: 300 }),
          visibility: 'public',
        }),
      }),
    );
    const result = res.json<SyncUpsertResult>();
    expect(result.applied).toBe('conflict_copy');
    expect(result.id).toBe(id);
    expect(result.conflict_copy_id).toBeTruthy();
    copyId = result.conflict_copy_id!;

    // The server row is untouched — no silent overwrite.
    const after = await as(USER_A, () => app.inject({ url: `/v1/recipes/${id}` }));
    expect(after.json<Recipe>()).toMatchObject({
      version: 2,
      updated_at: beforeRecipe.updated_at,
    });
    expect(after.json<Recipe>().params).toMatchObject({ dose_g: 16 });
  });

  it('the copy is labelled, private, diffed — and is NOT a fork', async () => {
    const res = await as(USER_A, () => app.inject({ url: `/v1/recipes/${copyId}` }));
    const copy = res.json<Recipe>();
    expect(copy.title).toBe('Offline draft (conflicted copy)');
    expect(copy.visibility).toBe('private'); // never published on the user's behalf
    expect(copy.author_id).toBe(USER_A.userId);
    // Lineage stays clean: a sync artefact is not a fork (§6.6 analytics).
    expect(copy.parent_recipe_id).toBeNull();
    expect(copy.changed_fields).toEqual(['params.dose_g', 'params.water_g']);
  });
});

// ===========================================================================
describe('brew sessions — idempotent PUT and last-write-wins (EF §2.2, BREW-04)', () => {
  const id = uuid(201);
  let firstUpdatedAt = '';

  it('creates on the first PUT of a client-minted id', async () => {
    const res = await as(USER_A, () =>
      app.inject({ method: 'PUT', url: `/v1/brews/${id}`, payload: brewBody() }),
    );
    expect(res.statusCode).toBe(200);
    const result = res.json<SyncUpsertResult>();
    expect(result).toMatchObject({ id, applied: 'created' });
    firstUpdatedAt = result.updated_at;
  });

  it('IS IDEMPOTENT: the same body twice is one row and a noop', async () => {
    const res = await as(USER_A, () =>
      app.inject({ method: 'PUT', url: `/v1/brews/${id}`, payload: brewBody() }),
    );
    const result = res.json<SyncUpsertResult>();
    expect(result.applied).toBe('noop');
    // A noop must not move updated_at — otherwise every retry republishes the
    // row to the user's other devices.
    expect(result.updated_at).toBe(firstUpdatedAt);

    const count = await pg.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM brew_sessions WHERE id = $1::uuid`,
      [id],
    );
    expect(count.rows[0]!.count).toBe(1);
  });

  it('is idempotent regardless of JSON key order', async () => {
    const reordered = {
      source: 'new',
      params: { water_g: 250, brew_time_s: 165, dose_g: 15, temperature_c: 94, method: 'filter' },
      grind: { category: 'medium_fine', setting: '6.5', scale_type: 'stepped', equipment_model_id: ids.grinderOde },
      grinder_model_id: ids.grinderOde,
      brewer_model_id: ids.brewerV60,
      coffee_product_id: ids.coffee1,
    };
    const res = await as(USER_A, () =>
      app.inject({ method: 'PUT', url: `/v1/brews/${id}`, payload: reordered }),
    );
    expect(res.json<SyncUpsertResult>().applied).toBe('noop');
  });

  it('a changed body updates the same row', async () => {
    const res = await as(USER_A, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/brews/${id}`,
        payload: brewBody({ params: filterParams({ dose_g: 16 }), taste: { verdict: 'good' } }),
      }),
    );
    expect(res.json<SyncUpsertResult>().applied).toBe('updated');
    const count = await pg.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM brew_sessions WHERE id = $1::uuid`,
      [id],
    );
    expect(count.rows[0]!.count).toBe(1);
  });

  it('LAST-WRITE-WINS: a stale offline payload never clobbers a newer server row', async () => {
    const current = await as(USER_A, () => app.inject({ url: `/v1/brews/${id}` }));
    const server = current.json<BrewSession>();

    const stale = await as(USER_A, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/brews/${id}`,
        payload: brewBody({
          params: filterParams({ dose_g: 99 }),
          updated_at: new Date(Date.parse(server.updated_at) - 60_000).toISOString(),
        }),
      }),
    );
    expect(stale.json<SyncUpsertResult>().applied).toBe('noop');

    const after = await as(USER_A, () => app.inject({ url: `/v1/brews/${id}` }));
    expect(after.json<BrewSession>().params).toMatchObject({ dose_g: 16 });

    // A payload the client believes is newer does apply.
    const fresh = await as(USER_A, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/brews/${id}`,
        payload: brewBody({
          params: filterParams({ dose_g: 17 }),
          taste: { verdict: 'good' },
          updated_at: new Date(Date.parse(server.updated_at) + 60_000).toISOString(),
        }),
      }),
    );
    expect(fresh.json<SyncUpsertResult>().applied).toBe('updated');
  });

  it("user B cannot PUT over, READ or DELETE user A's session (IDOR)", async () => {
    const put = await as(USER_B, () =>
      app.inject({ method: 'PUT', url: `/v1/brews/${id}`, payload: brewBody() }),
    );
    expect(put.statusCode).toBe(403);

    const read = await as(USER_B, () => app.inject({ url: `/v1/brews/${id}` }));
    expect(read.statusCode).toBe(403);

    const del = await as(USER_B, () => app.inject({ method: 'DELETE', url: `/v1/brews/${id}` }));
    expect(del.statusCode).toBe(403);

    const owner = await pg.query<{ user_id: string }>(
      `SELECT user_id FROM brew_sessions WHERE id = $1::uuid`,
      [id],
    );
    expect(owner.rows[0]!.user_id).toBe(USER_A.userId);
  });

  it('computes changed_fields server-side against the previous brew of that coffee', async () => {
    const later = uuid(202);
    await as(USER_A, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/brews/${later}`,
        payload: brewBody({
          grind: grind(ids.grinderOde, '6.0', 'stepped'),
          params: filterParams({ dose_g: 17 }),
          brewed_at: new Date(Date.now() + 3_600_000).toISOString(),
          source: 'tweak',
        }),
      }),
    );
    const res = await as(USER_A, () => app.inject({ url: `/v1/brews/${later}` }));
    // Only the grind moved relative to the previous session (dose was already
    // 17) — the one-variable discipline captured for free.
    expect(res.json<BrewSession>().changed_fields).toEqual(['grind.setting']);
  });

  it('honours a client-supplied changed_fields instead of guessing', async () => {
    const explicit = uuid(203);
    await as(USER_A, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/brews/${explicit}`,
        payload: brewBody({ changed_fields: ['params.temperature_c'], source: 'tweak' }),
      }),
    );
    const res = await as(USER_A, () => app.inject({ url: `/v1/brews/${explicit}` }));
    expect(res.json<BrewSession>().changed_fields).toEqual(['params.temperature_c']);
  });

  it('lists own sessions with filters and a keyset cursor, never another user’s', async () => {
    await as(USER_B, () =>
      app.inject({ method: 'PUT', url: `/v1/brews/${uuid(204)}`, payload: brewBody() }),
    );

    const list = await as(USER_A, () => app.inject({ url: '/v1/brews?limit=100' }));
    const items = list.json<{ items: BrewSession[] }>().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((s) => s.user_id === USER_A.userId)).toBe(true);

    const byCoffee = await as(USER_A, () =>
      app.inject({ url: `/v1/brews?coffee_product_id=${ids.coffee2}&limit=100` }),
    );
    expect(byCoffee.json<{ items: BrewSession[] }>().items).toHaveLength(0);

    const paged = await as(USER_A, () => app.inject({ url: '/v1/brews?limit=1' }));
    const body = paged.json<{ items: BrewSession[]; next_cursor: string | null }>();
    expect(body.items).toHaveLength(1);
    expect(body.next_cursor).toBeTruthy();

    const next = await as(USER_A, () =>
      app.inject({ url: `/v1/brews?limit=1&cursor=${encodeURIComponent(body.next_cursor!)}` }),
    );
    expect(next.json<{ items: BrewSession[] }>().items[0]!.id).not.toBe(body.items[0]!.id);

    const tampered = await as(USER_A, () => app.inject({ url: '/v1/brews?cursor=nonsense' }));
    expect(tampered.statusCode).toBe(400);
  });

  it('soft-deletes so the deletion can reach every device', async () => {
    const doomed = uuid(205);
    await as(USER_A, () =>
      app.inject({ method: 'PUT', url: `/v1/brews/${doomed}`, payload: brewBody() }),
    );
    const del = await as(USER_A, () =>
      app.inject({ method: 'DELETE', url: `/v1/brews/${doomed}` }),
    );
    expect(del.statusCode).toBe(204);
    expect((await as(USER_A, () => app.inject({ url: `/v1/brews/${doomed}` }))).statusCode).toBe(404);
    const row = await pg.query<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM brew_sessions WHERE id = $1::uuid`,
      [doomed],
    );
    expect(row.rows[0]!.deleted_at).not.toBeNull();
  });

  it('accepts the offline queue echoing the id in the body, and 400s a mismatch', async () => {
    const echoed = uuid(206);
    const ok = await as(USER_A, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/brews/${echoed}`,
        // The web offline queue PUTs the whole local record (a BrewSession),
        // so `id`, `user_id` and the timestamps ride along.
        payload: brewBody({ id: echoed, user_id: USER_B.userId, params_schema_version: 1 }),
      }),
    );
    expect(ok.statusCode).toBe(200);
    // Ownership never comes from the payload.
    const owner = await pg.query<{ user_id: string }>(
      `SELECT user_id FROM brew_sessions WHERE id = $1::uuid`,
      [echoed],
    );
    expect(owner.rows[0]!.user_id).toBe(USER_A.userId);

    const mismatch = await as(USER_A, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/brews/${uuid(207)}`,
        payload: brewBody({ id: echoed }),
      }),
    );
    expect(mismatch.statusCode).toBe(400);
  });
});

// ===========================================================================
describe('taste → extraction diagnosis is server-authoritative (§6.7)', () => {
  it('the TypeScript mapping and the generated column agree on every verdict', async () => {
    const cases = [
      ['bitter', 'over_extracted'],
      ['sour', 'under_extracted'],
      ['weak', 'under_extracted'],
      ['good', 'balanced'],
    ] as const;

    for (const [index, [verdict, expected]] of cases.entries()) {
      const id = uuid(300 + index);
      await as(USER_A, () =>
        app.inject({
          method: 'PUT',
          url: `/v1/brews/${id}`,
          payload: brewBody({ coffee_product_id: ids.coffee3, taste: { verdict } }),
        }),
      );
      const row = await pg.query<{ diagnosis: string }>(
        `SELECT diagnosis FROM brew_sessions WHERE id = $1::uuid`,
        [id],
      );
      expect(row.rows[0]!.diagnosis).toBe(expected);
      expect(diagnoseTaste({ verdict })).toBe(expected);
    }
  });

  it('no verdict means unclear, not a guess', async () => {
    const id = uuid(310);
    await as(USER_A, () =>
      app.inject({ method: 'PUT', url: `/v1/brews/${id}`, payload: brewBody({ rating: 5 }) }),
    );
    const row = await pg.query<{ diagnosis: string }>(
      `SELECT diagnosis FROM brew_sessions WHERE id = $1::uuid`,
      [id],
    );
    expect(row.rows[0]!.diagnosis).toBe('unclear');
    expect(diagnoseTaste(null)).toBe('unclear');
  });
});

// ===========================================================================
describe('grind conversion capture — confirmed brews only (GC-02, risk #9)', () => {
  let parentId = '';
  let forkId = '';

  const pairCount = async (): Promise<{ rows: number; data_points: number }> => {
    const res = await pg.query<{ rows: number; data_points: number }>(
      `SELECT count(*)::int AS rows, coalesce(sum(data_points),0)::int AS data_points
         FROM grind_conversions
        WHERE from_model_id = $1::uuid AND to_model_id = $2::uuid`,
      [ids.grinderOde, ids.grinderComandante],
    );
    return res.rows[0]!;
  };

  beforeAll(async () => {
    const parent = await as(USER_A, () =>
      app.inject({
        method: 'POST',
        url: '/v1/recipes',
        payload: recipeBody({
          title: 'Conversion parent',
          visibility: 'public',
          coffee_product_id: ids.coffee2,
          grind: grind(ids.grinderOde, '6.5', 'stepped'),
        }),
      }),
    );
    parentId = parent.json<Recipe>().id;

    const fork = await as(USER_B, () =>
      app.inject({
        method: 'POST',
        url: `/v1/recipes/${parentId}/fork`,
        payload: { grind: grind(ids.grinderComandante, '22', 'rotational') },
      }),
    );
    forkId = fork.json<Recipe>().id;
  });

  it('records NOTHING from an unconfirmed fork (no brew at all)', async () => {
    expect((await pairCount()).rows).toBe(0);
  });

  it('records NOTHING when the confirmed brew was rated badly', async () => {
    await as(USER_B, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/brews/${uuid(401)}`,
        payload: brewBody({
          coffee_product_id: ids.coffee2,
          recipe_id: forkId,
          grind: grind(ids.grinderComandante, '22', 'rotational'),
          grinder_model_id: ids.grinderComandante,
          taste: { verdict: 'bitter' },
          rating: 5, // a generous star rating does NOT override a bad verdict
          source: 'tweak',
        }),
      }),
    );
    expect((await pairCount()).rows).toBe(0);
    const obs = await pg.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM brew_grind_observations`,
    );
    expect(obs.rows[0]!.count).toBe(0);
  });

  it('records the pair when a cross-grinder fork brews GOOD', async () => {
    await as(USER_B, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/brews/${uuid(402)}`,
        payload: brewBody({
          coffee_product_id: ids.coffee2,
          recipe_id: forkId,
          grind: grind(ids.grinderComandante, '22', 'rotational'),
          grinder_model_id: ids.grinderComandante,
          taste: { verdict: 'good' },
          source: 'tweak',
        }),
      }),
    );
    const pair = await pairCount();
    expect(pair.rows).toBe(1);
    expect(pair.data_points).toBe(1);

    const row = await pg.query<{ source: string; from_setting: string; to_setting: string }>(
      `SELECT source, from_setting, to_setting FROM grind_conversions
        WHERE from_model_id = $1::uuid AND to_model_id = $2::uuid`,
      [ids.grinderOde, ids.grinderComandante],
    );
    expect(row.rows[0]).toMatchObject({
      source: 'user_confirmed',
      from_setting: '6.5',
      to_setting: '22',
    });
    expect(
      (
        await pg.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM brew_grind_observations WHERE brew_session_id = $1::uuid`,
          [uuid(402)],
        )
      ).rows[0]!.count,
    ).toBe(1);
  });

  it('never double-counts when the same session is re-synced or edited', async () => {
    for (const payload of [
      { taste: { verdict: 'good' } },
      { taste: { verdict: 'good' }, rating: 5 },
      { taste: { verdict: 'good' }, rating: 4 },
    ]) {
      await as(USER_B, () =>
        app.inject({
          method: 'PUT',
          url: `/v1/brews/${uuid(402)}`,
          payload: brewBody({
            coffee_product_id: ids.coffee2,
            recipe_id: forkId,
            grind: grind(ids.grinderComandante, '22', 'rotational'),
            grinder_model_id: ids.grinderComandante,
            source: 'tweak',
            ...payload,
          }),
        }),
      );
    }
    expect(await pairCount()).toMatchObject({ rows: 1, data_points: 1 });
  });

  it('counts a second, independent confirmation', async () => {
    const fork2 = await as(USER_A, () =>
      app.inject({
        method: 'POST',
        url: `/v1/recipes/${parentId}/fork`,
        payload: { grind: grind(ids.grinderComandante, '22', 'rotational') },
      }),
    );
    await as(USER_A, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/brews/${uuid(403)}`,
        payload: brewBody({
          coffee_product_id: ids.coffee2,
          recipe_id: fork2.json<Recipe>().id,
          grind: grind(ids.grinderComandante, '22', 'rotational'),
          grinder_model_id: ids.grinderComandante,
          rating: 5, // 4+ stars with no contradicting verdict counts as good
          source: 'tweak',
        }),
      }),
    );
    expect(await pairCount()).toMatchObject({ rows: 1, data_points: 2 });
  });

  it('records nothing when the grinder did not actually change', async () => {
    const sameGrinderFork = await as(USER_B, () =>
      app.inject({
        method: 'POST',
        url: `/v1/recipes/${parentId}/fork`,
        payload: { params: filterParams({ dose_g: 20 }) },
      }),
    );
    const before = await pairCount();
    await as(USER_B, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/brews/${uuid(404)}`,
        payload: brewBody({
          coffee_product_id: ids.coffee2,
          recipe_id: sameGrinderFork.json<Recipe>().id,
          taste: { verdict: 'good' },
          source: 'tweak',
        }),
      }),
    );
    expect(await pairCount()).toEqual(before);
  });

  it('records nothing for a good brew on a recipe that is not a fork', async () => {
    const before = await pairCount();
    await as(USER_A, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/brews/${uuid(405)}`,
        payload: brewBody({
          coffee_product_id: ids.coffee2,
          recipe_id: parentId,
          grind: grind(ids.grinderComandante, '22', 'rotational'),
          grinder_model_id: ids.grinderComandante,
          taste: { verdict: 'good' },
          source: 'tweak',
        }),
      }),
    );
    expect(await pairCount()).toEqual(before);
  });

  it('emits grind_conversion.confirmed.v1 through the outbox', async () => {
    const events = await pg.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM domain_events WHERE event_type = 'grind_conversion.confirmed.v1'`,
    );
    expect(events.rows[0]!.count).toBe(2);
  });

  it('surfaces the suggestion with confidence, sample size and a disclaimer (GC-03)', async () => {
    const res = await as(USER_B, () =>
      app.inject({
        url: `/v1/grind-conversions/suggest?from_model_id=${ids.grinderOde}&from_setting=6.5&to_model_id=${ids.grinderComandante}&category=medium_fine`,
      }),
    );
    expect(res.statusCode).toBe(200);
    const suggestion = res.json<GrindConversionSuggestion>();
    expect(suggestion.suggested_setting).toBe('22');
    expect(suggestion.source).toBe('user_confirmed');
    expect(suggestion.sample_size).toBeGreaterThan(0);
    expect(suggestion.confidence).toBeGreaterThan(0);
    expect(suggestion.disclaimer.length).toBeGreaterThan(0);
  });

  it('is honest when there is no data: category only, never a fabricated setting', async () => {
    const res = await as(USER_B, () =>
      app.inject({
        url: `/v1/grind-conversions/suggest?from_model_id=${ids.grinderComandante}&to_model_id=${ids.grinderOde}&category=medium`,
      }),
    );
    const suggestion = res.json<GrindConversionSuggestion>();
    expect(suggestion.suggested_setting).toBeNull();
    expect(suggestion.sample_size).toBe(0);
    expect(suggestion.confidence).toBe(0);
    expect(suggestion.source).toBe('category_only');
    expect(suggestion.disclaimer.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe('prefill — what makes the 15-second bar possible (BREW-03 seam)', () => {
  it('falls back to defaults when there is nothing to go on', async () => {
    const res = await as(USER_B, () =>
      app.inject({ url: `/v1/brews/prefill?coffee_product_id=${ids.coffee3}` }),
    );
    expect(res.statusCode).toBe(200);
    const prefill = res.json<BrewPrefill>();
    expect(prefill.basis).toBe('defaults');
    expect(prefill.params).toMatchObject({ method: 'filter', dose_g: 15, water_g: 250 });
    expect(prefill.grind.category).toBe('medium');
    expect(prefill.recipe_id).toBeNull();
  });

  it('prefers an OFFICIAL recipe over a community one', async () => {
    const community = await as(USER_B, () =>
      app.inject({
        method: 'POST',
        url: '/v1/recipes',
        payload: recipeBody({
          title: 'Community sidamo',
          coffee_product_id: ids.coffee3,
          visibility: 'public',
          params: filterParams({ dose_g: 20, water_g: 320 }),
        }),
      }),
    );
    const communityRes = await as(USER_B, () =>
      app.inject({ url: `/v1/brews/prefill?coffee_product_id=${ids.coffee3}` }),
    );
    expect(communityRes.json<BrewPrefill>().basis).toBe('community_recipe');
    expect(communityRes.json<BrewPrefill>().recipe_id).toBe(community.json<Recipe>().id);

    const official = await as(USER_A, () =>
      app.inject({
        method: 'POST',
        url: '/v1/recipes',
        payload: recipeBody({
          title: 'Roaster sidamo',
          coffee_product_id: ids.coffee3,
          visibility: 'public',
          params: filterParams({ dose_g: 22, water_g: 350 }),
        }),
      }),
    );
    // `is_official` is a staff/publish flag, so it is set the way the editorial
    // path would set it rather than by the user.
    await pg.query(`UPDATE recipes SET is_official = true WHERE id = $1::uuid`, [
      official.json<Recipe>().id,
    ]);

    const res = await as(USER_B, () =>
      app.inject({ url: `/v1/brews/prefill?coffee_product_id=${ids.coffee3}` }),
    );
    const prefill = res.json<BrewPrefill>();
    expect(prefill.basis).toBe('official_recipe');
    expect(prefill.recipe_id).toBe(official.json<Recipe>().id);
    expect(prefill.params).toMatchObject({ dose_g: 22 });
  });

  it("prefers the user's OWN last session over any recipe", async () => {
    const sessionId = uuid(501);
    await as(USER_B, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/brews/${sessionId}`,
        payload: brewBody({
          coffee_product_id: ids.coffee3,
          params: filterParams({ dose_g: 18, water_g: 288 }),
          grind: grind(ids.grinderComandante, '25', 'rotational'),
          grinder_model_id: ids.grinderComandante,
        }),
      }),
    );

    const res = await as(USER_B, () =>
      app.inject({ url: `/v1/brews/prefill?coffee_product_id=${ids.coffee3}` }),
    );
    const prefill = res.json<BrewPrefill>();
    expect(prefill.basis).toBe('last_session');
    expect(prefill.last_session_id).toBe(sessionId);
    expect(prefill.params).toMatchObject({ dose_g: 18, water_g: 288, ratio: 16 });
    expect(prefill.grind).toMatchObject({ setting: '25', equipment_model_id: ids.grinderComandante });
  });

  it('keeps the category but drops a setting read off a different grinder (§6.4)', async () => {
    // USER_A's most recent equipment is the Comandante (from the conversion
    // tests); the official recipe for coffee1 was ground on the Ode.
    const official = await as(USER_A, () =>
      app.inject({
        method: 'POST',
        url: '/v1/recipes',
        payload: recipeBody({
          title: 'Ode-ground official',
          coffee_product_id: ids.coffee2,
          visibility: 'public',
          grind: grind(ids.grinderOde, '6.5', 'stepped', 'medium_fine'),
        }),
      }),
    );
    await pg.query(`UPDATE recipes SET is_official = true WHERE id = $1::uuid`, [
      official.json<Recipe>().id,
    ]);

    const res = await as(USER_A, () =>
      app.inject({ url: `/v1/brews/prefill?coffee_product_id=${ids.coffee2}` }),
    );
    const prefill = res.json<BrewPrefill>();
    if (prefill.basis === 'official_recipe') {
      expect(prefill.grind.category).toBe('medium_fine');
      expect(prefill.grind.setting).toBeNull();
    } else {
      // A last session exists for this coffee, which legitimately wins.
      expect(prefill.basis).toBe('last_session');
    }
  });

  it('requires authentication', async () => {
    expect((await app.inject({ url: '/v1/brews/prefill' })).statusCode).toBe(401);
  });
});

// ===========================================================================
describe('GET /v1/sync/changes — the caller’s own rows only (BREW-05)', () => {
  it('returns only the caller’s brews and recipes', async () => {
    const res = await as(USER_A, () => app.inject({ url: '/v1/sync/changes?limit=500' }));
    expect(res.statusCode).toBe(200);
    const body = res.json<SyncChangesResponse>();
    expect(body.changes.length).toBeGreaterThan(0);

    for (const change of body.changes) {
      if (change.deleted) continue;
      if (change.type === 'brew_session') {
        expect((change.resource as BrewSession).user_id).toBe(USER_A.userId);
      } else {
        expect((change.resource as Recipe).author_id).toBe(USER_A.userId);
      }
    }

    const bIds = await pg.query<{ id: string }>(
      `SELECT id FROM brew_sessions WHERE user_id = $1::uuid
       UNION ALL SELECT id FROM recipes WHERE author_id = $1::uuid`,
      [USER_B.userId],
    );
    const returned = new Set(body.changes.map((c) => c.id));
    for (const row of bIds.rows) expect(returned.has(row.id)).toBe(false);
    expect(bIds.rows.length).toBeGreaterThan(0); // the test would be vacuous otherwise
  });

  it('filters by type', async () => {
    const res = await as(USER_A, () =>
      app.inject({ url: '/v1/sync/changes?types=recipe&limit=500' }),
    );
    const body = res.json<SyncChangesResponse>();
    expect(body.changes.length).toBeGreaterThan(0);
    expect(body.changes.every((c) => c.type === 'recipe')).toBe(true);

    const bad = await as(USER_A, () => app.inject({ url: '/v1/sync/changes?types=posts' }));
    expect(bad.statusCode).toBe(400);
  });

  it('pages forward with a resumable cursor and never repeats a row', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 100; guard += 1) {
      const url = `/v1/sync/changes?limit=3${cursor ? `&since=${encodeURIComponent(cursor)}` : ''}`;
      const page: SyncChangesResponse = await as(USER_A, async () =>
        (await app.inject({ url })).json<SyncChangesResponse>(),
      );
      seen.push(...page.changes.map((c) => `${c.type}:${c.id}`));
      cursor = page.cursor;
      if (!page.has_more) break;
    }
    expect(seen.length).toBeGreaterThan(3);
    expect(new Set(seen).size).toBe(seen.length);

    const all = await as(USER_A, () => app.inject({ url: '/v1/sync/changes?limit=500' }));
    expect(seen.length).toBe(all.json<SyncChangesResponse>().changes.length);
  });

  it('delivers a tombstone so a deletion propagates', async () => {
    const doomed = uuid(601);
    await as(USER_A, () =>
      app.inject({ method: 'PUT', url: `/v1/brews/${doomed}`, payload: brewBody() }),
    );
    await as(USER_A, () => app.inject({ method: 'DELETE', url: `/v1/brews/${doomed}` }));

    const res = await as(USER_A, () => app.inject({ url: '/v1/sync/changes?limit=500' }));
    const tombstone = res
      .json<SyncChangesResponse>()
      .changes.find((c) => c.id === doomed);
    expect(tombstone).toBeDefined();
    expect(tombstone!.deleted).toBe(true);
    expect(tombstone!.resource).toBeUndefined();
  });

  it('requires authentication', async () => {
    expect((await app.inject({ url: '/v1/sync/changes' })).statusCode).toBe(401);
  });
});

// ===========================================================================
describe('events and audit', () => {
  it('emits brew.logged.v1 with the server-authoritative diagnosis (BREW-08)', async () => {
    const res = await pg.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM domain_events
        WHERE event_type = 'brew.logged.v1' AND payload->>'diagnosis' = 'over_extracted'
        LIMIT 1`,
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0]!.payload).toMatchObject({ method: 'filter' });
  });

  it('emits recipe.forked.v1 carrying the parent and the diff', async () => {
    const res = await pg.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM domain_events WHERE event_type = 'recipe.forked.v1' LIMIT 1`,
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0]!.payload).toHaveProperty('parent_recipe_id');
    expect(res.rows[0]!.payload).toHaveProperty('parent_author_id');
  });

  it('leaves every event unpublished for the relay to pick up', async () => {
    const res = await pg.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM domain_events WHERE published_at IS NULL`,
    );
    expect(res.rows[0]!.count).toBeGreaterThan(0);
  });

  it('writes permission-relevant recipe actions to the append-only audit log', async () => {
    const res = await pg.query<{ action: string }>(
      `SELECT DISTINCT action FROM audit_log WHERE target_type = 'recipe' ORDER BY action`,
    );
    const actions = res.rows.map((r) => r.action);
    expect(actions).toContain('recipe.created');
    expect(actions).toContain('recipe.forked');
    expect(actions).toContain('recipe.deleted');
    expect(actions).toContain('recipe.conflict_copy_created');
  });
});

// ===========================================================================
describe('recipe reviews', () => {
  it('accepts one review per user per recipe and updates it in place', async () => {
    const recipe = await as(USER_A, () =>
      app.inject({
        method: 'POST',
        url: '/v1/recipes',
        payload: recipeBody({ title: 'Reviewed', visibility: 'public' }),
      }),
    );
    const id = recipe.json<Recipe>().id;

    const first = await as(USER_B, () =>
      app.inject({ method: 'PUT', url: `/v1/recipes/${id}/reviews`, payload: { rating: 4 } }),
    );
    expect(first.statusCode).toBe(200);

    await as(USER_B, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/recipes/${id}/reviews`,
        payload: { rating: 5, body: 'Better with a finer grind.' },
      }),
    );

    const list = await as(USER_B, () => app.inject({ url: `/v1/recipes/${id}/reviews` }));
    const items = list.json<{ items: { rating: number }[] }>().items;
    expect(items).toHaveLength(1);
    expect(items[0]!.rating).toBe(5);
  });

  it('cannot review a private recipe belonging to someone else', async () => {
    const priv = await as(USER_A, () =>
      app.inject({ method: 'POST', url: '/v1/recipes', payload: recipeBody({ title: 'Unreviewable' }) }),
    );
    const res = await as(USER_B, () =>
      app.inject({
        method: 'PUT',
        url: `/v1/recipes/${priv.json<Recipe>().id}/reviews`,
        payload: { rating: 1 },
      }),
    );
    expect(res.statusCode).toBe(403);
  });
});
