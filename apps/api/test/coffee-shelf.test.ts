/**
 * Photograph a bag, get a coffee (0014), against a real Postgres engine.
 *
 * The claims worth pinning are the ones that make an auto-publishing catalogue
 * survivable, plus the one that makes the feature worth having at all:
 *
 *   - the bag reaches your shelf even when the catalogue does not get a row
 *   - a roaster minted from a submission is NEVER verified
 *   - a coffee you already have is not created twice
 *   - a roast date that cannot be true is dropped rather than believed
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  addToShelf,
  finishBag,
  listShelf,
  removeFromShelf,
} from '../src/modules/brewing/user-coffees.js';
import type { BrewingDb } from '../src/modules/brewing/types.js';
import {
  findExistingCoffee,
  freeCoffeeSlug,
  insertCoffee,
  recordRoastBatch,
  upsertRoasterByName,
} from '../src/modules/catalog/index.js';
import { isCoffeePublishable, parseRoastDate } from '../src/modules/intelligence/index.js';
import type { CoffeeDraft } from '../src/modules/intelligence/index.js';

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
  'db/migrations/0010_user_equipment.sql',
  'db/migrations/0011_custom_equipment.sql',
  'db/migrations/0012_equipment_submission_media.sql',
  'db/migrations/0013_community_catalogue.sql',
  'db/migrations/0014_community_coffee.sql',
];

let pg: PGlite;
let db: BrewingDb;
let userId = '';

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { citext, pgcrypto } });
  for (const file of MIGRATIONS) {
    const sql = (await readFile(repoRoot + file, 'utf8'))
      .replace(/CREATE EXTENSION IF NOT EXISTS vector;/g, '-- vector')
      .replace(/CREATE EXTENSION IF NOT EXISTS pg_trgm;/g, '-- pg_trgm')
      .replace(
        /CREATE INDEX IF NOT EXISTS \w+\n\s+ON \w+ USING gin \(lower\(name\) gin_trgm_ops\);/g,
        '-- trigram index',
      );
    await pg.exec(sql);
  }
  db = {
    query: async <T>(text: string, params: readonly unknown[] = []) =>
      pg.query(text, params as unknown[]) as unknown as Promise<{ rows: T[] }>,
  } as BrewingDb;

  const { rows } = await pg.query<{ id: string }>(
    `INSERT INTO users (email, handle, password_hash, email_verified_at)
          VALUES ('drinker@brewcult.test', 'drinker', 'x', now()) RETURNING id::text AS id`,
  );
  userId = rows[0]!.id;
}, 180_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await pg.query('DELETE FROM user_coffees');
  await pg.query('DELETE FROM roast_batches');
  await pg.query("DELETE FROM coffee_products WHERE source = 'community'");
  await pg.query("DELETE FROM roasters WHERE source = 'community'");
});

const draft = (over: Partial<CoffeeDraft> = {}): CoffeeDraft => ({
  roaster: 'Onyx Coffee Lab',
  name: 'Ethiopia Guji Uraga',
  roast_level: 'light',
  intended_use: 'filter',
  tasting_notes: ['peach', 'jasmine'],
  confidence: 'high',
  is_coffee: true,
  publish_ready: true,
  notes: '',
  ...over,
});

describe('deciding whether a label may be published', () => {
  it('publishes when the roaster and the coffee are legible', () => {
    expect(isCoffeePublishable(draft())).toBe(true);
  });

  it('accepts medium confidence, unlike equipment', () => {
    // Reading a label is not recalling a product. "Fairly sure I read that
    // correctly" is a different claim from "fairly sure that is a P100", and
    // holding both to the same bar would reject most real bags.
    expect(isCoffeePublishable(draft({ confidence: 'medium' }))).toBe(true);
    expect(isCoffeePublishable(draft({ confidence: 'low' }))).toBe(false);
  });

  it('refuses a bag it could not read the roaster off', () => {
    expect(isCoffeePublishable(draft({ roaster: '   ' }))).toBe(false);
    expect(isCoffeePublishable(draft({ name: '' }))).toBe(false);
  });

  it('refuses anything that is not a bag of coffee', () => {
    expect(isCoffeePublishable(draft({ is_coffee: false }))).toBe(false);
    expect(isCoffeePublishable(draft({ publish_ready: false }))).toBe(false);
  });

  it('refuses a roast level or use the catalogue does not have', () => {
    expect(isCoffeePublishable(draft({ roast_level: 'extra-dark' }))).toBe(false);
    expect(isCoffeePublishable(draft({ intended_use: 'cold-brew' }))).toBe(false);
  });
});

describe('roast dates', () => {
  it('keeps a date that could be a real roast', () => {
    const recent = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(parseRoastDate(recent)).toBe(recent);
  });

  it('drops what cannot be true', () => {
    const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    // A future date is a misread best-before; 1970 is a broken parse. Both make
    // freshness advice confidently wrong, which is worse than having none.
    expect(parseRoastDate(nextYear)).toBeNull();
    expect(parseRoastDate('1970-01-01')).toBeNull();
    expect(parseRoastDate('last Tuesday')).toBeNull();
    expect(parseRoastDate(undefined)).toBeNull();
  });
});

describe('minting a roaster from a submission', () => {
  it('never marks it verified', async () => {
    const { id, created } = await upsertRoasterByName(db as never, 'Onyx Coffee Lab', userId);
    expect(created).toBe(true);

    const { rows } = await pg.query<{ verified: boolean; source: string }>(
      `SELECT verified, source FROM roasters WHERE id = $1::uuid`,
      [id],
    );
    // `verified` is the difference between "somebody typed this name" and "we
    // know this business". Reading a label cannot establish the second.
    expect(rows[0]).toMatchObject({ verified: false, source: 'community' });
  });

  it('treats different capitalisation as one business', async () => {
    const first = await upsertRoasterByName(db as never, 'Onyx Coffee Lab', userId);
    const second = await upsertRoasterByName(db as never, 'onyx coffee lab', userId);
    expect(second.id).toBe(first.id);
    expect(second.created).toBe(false);
  });

  it('finds a free slug rather than refusing a submission', async () => {
    await upsertRoasterByName(db as never, 'Onyx Coffee', userId);
    // Different name, same slug root.
    const second = await upsertRoasterByName(db as never, 'Onyx  Coffee!', userId);
    const { rows } = await pg.query<{ slug: string }>(
      `SELECT slug FROM roasters WHERE id = $1::uuid`,
      [second.id],
    );
    expect(rows[0]?.slug).toBeTruthy();
  });
});

describe('the catalogue side', () => {
  it('does not create the same coffee twice for one roaster', async () => {
    const roaster = await upsertRoasterByName(db as never, 'Onyx Coffee Lab', userId);
    const slug = await freeCoffeeSlug(db as never, 'Onyx Ethiopia Guji Uraga');
    await insertCoffee(db as never, {
      roaster_id: roaster.id,
      name: 'Ethiopia Guji Uraga',
      slug,
      roast_level: 'light' as never,
      intended_use: 'filter' as never,
      source: 'community',
      submitted_by: userId,
    });

    // The second photo of the same bag reads slightly differently.
    const found = await findExistingCoffee(db as never, {
      roasterId: roaster.id,
      name: 'ethiopia guji uraga',
    });
    expect(found).toMatchObject({ name: 'Ethiopia Guji Uraga' });
  });

  it('keeps two roasters’ versions of the same origin apart', async () => {
    const onyx = await upsertRoasterByName(db as never, 'Onyx Coffee Lab', userId);
    const other = await upsertRoasterByName(db as never, 'Sey Coffee', userId);
    await insertCoffee(db as never, {
      roaster_id: onyx.id,
      name: 'Ethiopia Guji',
      slug: await freeCoffeeSlug(db as never, 'Onyx Ethiopia Guji'),
      roast_level: 'light' as never,
      intended_use: 'filter' as never,
      source: 'community',
    });

    // "Ethiopia Guji" from two roasters is two different coffees.
    expect(
      await findExistingCoffee(db as never, { roasterId: other.id, name: 'Ethiopia Guji' }),
    ).toBeNull();
  });

  it('records the roast date as a batch, which is where freshness lives', async () => {
    const roaster = await upsertRoasterByName(db as never, 'Onyx Coffee Lab', userId);
    const coffee = await insertCoffee(db as never, {
      roaster_id: roaster.id,
      name: 'Ethiopia Guji Uraga',
      slug: await freeCoffeeSlug(db as never, 'Onyx Ethiopia Guji Uraga'),
      roast_level: 'light' as never,
      intended_use: 'filter' as never,
      source: 'community',
    });
    await recordRoastBatch(db as never, coffee.id, '2026-08-01');
    await recordRoastBatch(db as never, coffee.id, '2026-08-01'); // same bag, twice

    const { rows } = await pg.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM roast_batches WHERE coffee_product_id = $1::uuid`,
      [coffee.id],
    );
    expect(rows[0]?.n).toBe('1');
  });
});

describe('the shelf', () => {
  it('takes a bag with no catalogue row at all', async () => {
    const result = await addToShelf(db, {
      userId,
      customRoaster: 'A roastery down the road',
      customName: 'Whatever this is',
      roastDate: '2026-08-01',
    });

    expect(result.status).toBe('added');
    if (result.status !== 'added') return;
    // This is the half that matters tonight: something to log a brew against.
    expect(result.item).toMatchObject({
      name: 'Whatever this is',
      roaster: 'A roastery down the road',
      is_custom: true,
    });
  });

  it('joins the catalogue detail when there IS a row', async () => {
    const roaster = await upsertRoasterByName(db as never, 'Onyx Coffee Lab', userId);
    const coffee = await insertCoffee(db as never, {
      roaster_id: roaster.id,
      name: 'Ethiopia Guji Uraga',
      slug: await freeCoffeeSlug(db as never, 'Onyx Ethiopia Guji Uraga'),
      roast_level: 'light' as never,
      intended_use: 'filter' as never,
      tasting_notes: ['peach', 'jasmine'],
      source: 'community',
    });

    const result = await addToShelf(db, { userId, coffeeProductId: coffee.id });
    expect(result.status).toBe('added');
    if (result.status !== 'added') return;
    expect(result.item).toMatchObject({
      name: 'Ethiopia Guji Uraga',
      roaster: 'Onyx Coffee Lab',
      roast_level: 'light',
      is_custom: false,
    });
    expect(result.item.tasting_notes).toEqual(['peach', 'jasmine']);
  });

  it('treats the same open bag twice as a double-click', async () => {
    const input = { userId, customName: 'Same bag' };
    expect((await addToShelf(db, input)).status).toBe('added');
    expect((await addToShelf(db, input)).status).toBe('already_there');
    expect(await listShelf(db, userId)).toHaveLength(1);
  });

  it('lets you buy the same coffee again once the first bag is finished', async () => {
    const first = await addToShelf(db, { userId, customName: 'Ethiopia Guji' });
    if (first.status !== 'added') throw new Error('expected the first bag');

    expect(await finishBag(db, userId, first.item.id)).toBe(true);

    // A second bag in six months is a new bag, not a duplicate — and the two
    // need to be distinguishable when somebody asks why it tasted different.
    const second = await addToShelf(db, { userId, customName: 'Ethiopia Guji' });
    expect(second.status).toBe('added');
    expect(await listShelf(db, userId)).toHaveLength(2);
  });

  it('keeps a finished bag rather than deleting it', async () => {
    const bag = await addToShelf(db, { userId, customName: 'Drunk already' });
    if (bag.status !== 'added') throw new Error('expected a bag');
    await finishBag(db, userId, bag.item.id);

    const shelf = await listShelf(db, userId);
    // Past brews still point at it.
    expect(shelf[0]?.finished_at).toBeTruthy();
  });

  it('removes a mis-scan outright, and only for its owner', async () => {
    const bag = await addToShelf(db, { userId, customName: 'Wrong photo' });
    if (bag.status !== 'added') throw new Error('expected a bag');

    const { rows } = await pg.query<{ id: string }>(
      `INSERT INTO users (email, handle, password_hash) VALUES ('other@brewcult.test','otherone','x')
       RETURNING id::text AS id`,
    );
    expect(await removeFromShelf(db, rows[0]!.id, bag.item.id)).toBe(false);
    expect(await removeFromShelf(db, userId, bag.item.id)).toBe(true);
  });

  it('refuses a roast date the database would refuse', async () => {
    await expect(
      addToShelf(db, { userId, customName: 'Time traveller', roastDate: '2099-01-01' }),
    ).rejects.toThrow();
  });
});
