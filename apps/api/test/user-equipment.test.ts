/**
 * Owned equipment (0010), against a real Postgres engine.
 *
 * The interesting behaviour is not "can I insert a row" — it is the two things
 * the database is asked to guarantee, because the API cannot be trusted to:
 *
 *   - you cannot own the same model twice (UNIQUE)
 *   - you cannot have two primary grinders (partial UNIQUE on the category)
 *
 * That second one matters: the grind converter asks for "your grinder", and a
 * question with two answers gets an arbitrary one.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  addCustomEquipment,
  addOwnedEquipment,
  listOwnedEquipment,
  removeOwnedEquipment,
  setPrimaryEquipment,
} from '../src/modules/brewing/user-equipment.js';
import type { BrewingDb } from '../src/modules/brewing/types.js';

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
];

let pg: PGlite;
let db: BrewingDb;
let userId = '';
let otherUserId = '';
const models: Record<string, string> = {};

/**
 * 0003 requires grinders to declare a grind scale and forbids it on anything
 * else, so the fixture has to respect that rather than pass NULL everywhere.
 */
async function seedModel(brand: string, name: string, slug: string, category: string) {
  const grindScale = category === 'grinder' ? 'stepped' : null;
  const b = await pg.query<{ id: string }>(
    `INSERT INTO equipment_brands (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id::text AS id`,
    [brand],
  );
  const m = await pg.query<{ id: string }>(
    `INSERT INTO equipment_models (brand_id, category, name, slug, specs, grind_scale_type)
          VALUES ($1::uuid, $2, $3, $4, '{}'::jsonb, $5) RETURNING id::text AS id`,
    [b.rows[0]!.id, category, name, slug, grindScale],
  );
  models[slug] = m.rows[0]!.id;
}

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
  };

  const mk = async (email: string) =>
    (
      await pg.query<{ id: string }>(
        `INSERT INTO users (email, handle, password_hash, email_verified_at)
              VALUES ($1, $2, 'x', now()) RETURNING id::text AS id`,
        [email, email.split('@')[0]],
      )
    ).rows[0]!.id;
  userId = await mk('owner@brewcult.test');
  otherUserId = await mk('someone-else@brewcult.test');

  await seedModel('Niche', 'Zero', 'niche-zero', 'grinder');
  await seedModel('1Zpresso', 'JX-Pro', '1zpresso-jx-pro', 'grinder');
  await seedModel('Hario', 'V60 02', 'hario-v60-02', 'brewer');
}, 180_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await pg.query('DELETE FROM user_equipment');
});

describe('claiming equipment', () => {
  it('adds a model and reports it back with catalogue detail joined in', async () => {
    const result = await addOwnedEquipment(db, {
      userId,
      equipmentModelId: models['niche-zero']!,
    });
    expect(result.status).toBe('added');
    if (result.status !== 'added') return;

    // Brand, category and grind scale come from the catalogue, never copied.
    expect(result.item).toMatchObject({
      name: 'Zero',
      brand: 'Niche',
      category: 'grinder',
      is_primary: false,
    });
  });

  it('treats adding the same model twice as a double-click, not an error', async () => {
    const input = { userId, equipmentModelId: models['niche-zero']! };
    expect((await addOwnedEquipment(db, input)).status).toBe('added');
    expect((await addOwnedEquipment(db, input)).status).toBe('already_owned');
    expect(await listOwnedEquipment(db, userId)).toHaveLength(1);
  });

  it('refuses a model that is not in the catalogue', async () => {
    const result = await addOwnedEquipment(db, {
      userId,
      equipmentModelId: '00000000-0000-0000-0000-000000000000',
    });
    expect(result.status).toBe('unknown_model');
  });

  it('keeps one person’s gear entirely out of another’s list', async () => {
    await addOwnedEquipment(db, { userId, equipmentModelId: models['niche-zero']! });
    expect(await listOwnedEquipment(db, otherUserId)).toEqual([]);
  });
});

describe('the primary slot', () => {
  it('allows exactly ONE primary per category, replacing rather than failing', async () => {
    await addOwnedEquipment(db, {
      userId,
      equipmentModelId: models['niche-zero']!,
      isPrimary: true,
    });
    await addOwnedEquipment(db, {
      userId,
      equipmentModelId: models['1zpresso-jx-pro']!,
      isPrimary: true,
    });

    const primaries = (await listOwnedEquipment(db, userId)).filter((i) => i.is_primary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]!.slug).toBe('1zpresso-jx-pro');
  });

  it('scopes the slot to the CATEGORY — a primary grinder and brewer coexist', async () => {
    await addOwnedEquipment(db, {
      userId,
      equipmentModelId: models['niche-zero']!,
      isPrimary: true,
    });
    await addOwnedEquipment(db, {
      userId,
      equipmentModelId: models['hario-v60-02']!,
      isPrimary: true,
    });
    expect((await listOwnedEquipment(db, userId)).filter((i) => i.is_primary)).toHaveLength(2);
  });

  it('two people may each have their own primary grinder', async () => {
    await addOwnedEquipment(db, {
      userId,
      equipmentModelId: models['niche-zero']!,
      isPrimary: true,
    });
    await addOwnedEquipment(db, {
      userId: otherUserId,
      equipmentModelId: models['niche-zero']!,
      isPrimary: true,
    });
    expect((await listOwnedEquipment(db, userId)).filter((i) => i.is_primary)).toHaveLength(1);
    expect((await listOwnedEquipment(db, otherUserId)).filter((i) => i.is_primary)).toHaveLength(1);
  });

  it('promotes an existing item and demotes the incumbent', async () => {
    const first = await addOwnedEquipment(db, {
      userId,
      equipmentModelId: models['niche-zero']!,
      isPrimary: true,
    });
    const second = await addOwnedEquipment(db, {
      userId,
      equipmentModelId: models['1zpresso-jx-pro']!,
    });
    if (first.status !== 'added' || second.status !== 'added') throw new Error('setup');

    await setPrimaryEquipment(db, userId, second.item.id);
    const list = await listOwnedEquipment(db, userId);
    expect(list.find((i) => i.id === second.item.id)!.is_primary).toBe(true);
    expect(list.find((i) => i.id === first.item.id)!.is_primary).toBe(false);
  });

  it('will not let one person promote another person’s row', async () => {
    const mine = await addOwnedEquipment(db, {
      userId,
      equipmentModelId: models['niche-zero']!,
    });
    if (mine.status !== 'added') throw new Error('setup');
    // Scoped by user_id in the query, so it reads as absent rather than being
    // found and then refused — no existence oracle.
    expect(await setPrimaryEquipment(db, otherUserId, mine.item.id)).toBeNull();
  });
});

describe('removal', () => {
  it('removes only your own row', async () => {
    const mine = await addOwnedEquipment(db, {
      userId,
      equipmentModelId: models['niche-zero']!,
    });
    if (mine.status !== 'added') throw new Error('setup');

    expect(await removeOwnedEquipment(db, otherUserId, mine.item.id)).toBe(false);
    expect(await listOwnedEquipment(db, userId)).toHaveLength(1);

    expect(await removeOwnedEquipment(db, userId, mine.item.id)).toBe(true);
    expect(await listOwnedEquipment(db, userId)).toHaveLength(0);
  });
});

describe('the database enforces it, not the API', () => {
  it('rejects a duplicate ownership row written directly', async () => {
    await addOwnedEquipment(db, { userId, equipmentModelId: models['niche-zero']! });
    await expect(
      pg.query(
        `INSERT INTO user_equipment (user_id, equipment_model_id)
              VALUES ($1::uuid, $2::uuid)`,
        [userId, models['niche-zero']!],
      ),
    ).rejects.toThrow();
  });

  it('rejects a second primary grinder written directly', async () => {
    await addOwnedEquipment(db, {
      userId,
      equipmentModelId: models['niche-zero']!,
      isPrimary: true,
    });
    await expect(
      pg.query(
        `INSERT INTO user_equipment
           (user_id, equipment_model_id, is_primary, primary_category)
         VALUES ($1::uuid, $2::uuid, true, 'grinder')`,
        [userId, models['1zpresso-jx-pro']!],
      ),
    ).rejects.toThrow();
  });
});

describe('custom equipment — gear the catalogue does not have', () => {
  it('records something with no catalogue row and marks it as yours', async () => {
    const result = await addCustomEquipment(db, {
      userId,
      brand: 'Fellow',
      name: 'Opus',
      category: 'grinder',
    });
    expect(result.status).toBe('added');
    if (result.status !== 'added') return;

    expect(result.item).toMatchObject({
      brand: 'Fellow',
      name: 'Opus',
      category: 'grinder',
      is_custom: true,
      equipment_model_id: null,
      slug: null,
    });
  });

  it('appears in the same list as catalogue gear', async () => {
    await addOwnedEquipment(db, { userId, equipmentModelId: models['niche-zero']! });
    await addCustomEquipment(db, { userId, name: 'Hand-me-down grinder', category: 'grinder' });

    // The LEFT JOIN matters here: an inner join would drop exactly the custom
    // rows this feature exists for.
    const list = await listOwnedEquipment(db, userId);
    expect(list).toHaveLength(2);
    expect(list.filter((i) => i.is_custom)).toHaveLength(1);
  });

  it('works with no brand at all', async () => {
    const result = await addCustomEquipment(db, {
      userId,
      name: 'Unbranded burr grinder',
      category: 'grinder',
    });
    expect(result.status).toBe('added');
    if (result.status !== 'added') return;
    expect(result.item.brand).toBeNull();
  });

  it('treats a case-different duplicate as the same thing', async () => {
    await addCustomEquipment(db, { userId, brand: 'Fellow', name: 'Opus', category: 'grinder' });
    const again = await addCustomEquipment(db, {
      userId,
      brand: 'FELLOW',
      name: 'opus',
      category: 'grinder',
    });
    expect(again.status).toBe('already_owned');
    expect(await listOwnedEquipment(db, userId)).toHaveLength(1);
  });

  it('lets a custom entry hold the primary slot, and yield it', async () => {
    await addCustomEquipment(db, {
      userId,
      name: 'Grandfather’s grinder',
      category: 'grinder',
      isPrimary: true,
    });
    await addOwnedEquipment(db, {
      userId,
      equipmentModelId: models['niche-zero']!,
      isPrimary: true,
    });
    const primaries = (await listOwnedEquipment(db, userId)).filter((i) => i.is_primary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]!.slug).toBe('niche-zero');
  });

  it('is invisible to everybody else', async () => {
    await addCustomEquipment(db, { userId, name: 'My secret grinder', category: 'grinder' });
    expect(await listOwnedEquipment(db, otherUserId)).toEqual([]);
  });

  it('the database refuses a row that is BOTH a model and a custom entry', async () => {
    // Otherwise a row could name a catalogue model and override its brand, and
    // every reader would have to decide which one wins.
    await expect(
      pg.query(
        `INSERT INTO user_equipment
           (user_id, equipment_model_id, custom_name, custom_category)
         VALUES ($1::uuid, $2::uuid, 'Confused', 'grinder')`,
        [userId, models['niche-zero']!],
      ),
    ).rejects.toThrow();
  });

  it('the database refuses a row that is NEITHER', async () => {
    await expect(
      pg.query(`INSERT INTO user_equipment (user_id) VALUES ($1::uuid)`, [userId]),
    ).rejects.toThrow();
  });
});
