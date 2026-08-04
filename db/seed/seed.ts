// BrewCult deterministic seed script (Wave 1, Lane D).
// Upserts by natural keys (slugs / unique constraints) so it is safe to re-run:
// rows keep their uuids across runs; changed JSON values overwrite in place.
//
// Run (Node >= 22.6):  node --experimental-strip-types seed.ts
// or:                  npx tsx seed.ts
// DATABASE_URL defaults to the dev compose instance (db/seed/README.md).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const load = (name: string) =>
  JSON.parse(readFileSync(join(here, 'data', name), 'utf8'));

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://brewcult:brewcult@localhost:5433/brewcult';

interface RoasterRow {
  slug: string; name: string; location: string | null; verified: boolean;
}
interface OriginRow { country: string; region: string | null; description: string | null; }
interface FarmRow { origin: string; name: string; story: string | null; }
interface LotSpec {
  origin: string; farm: string | null; varietals: string[]; process: string;
  process_detail?: string; altitude_masl: number | null; harvest_period: string | null;
}
interface ProductRow {
  slug: string; roaster: string; name: string; roast_level: string;
  intended_use: string; tasting_notes: string[]; status: string; lot: LotSpec;
}
interface ModelRow {
  slug: string; brand: string; category: string; name: string;
  grind_scale_type?: string; specs: Record<string, unknown>;
}
interface ConversionRow {
  from: string; from_setting: string; to: string; to_setting: string; confidence: number;
}

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  const counts: Record<string, number> = {};
  const bump = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };

  try {
    await client.query('BEGIN');

    // ---- roasters -----------------------------------------------------------
    const roasterIds = new Map<string, string>();
    for (const r of load('roasters.json') as RoasterRow[]) {
      const res = await client.query(
        `INSERT INTO roasters (name, slug, location, verified)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (slug) DO UPDATE
           SET name = EXCLUDED.name, location = EXCLUDED.location,
               verified = EXCLUDED.verified
         RETURNING id`,
        [r.name, r.slug, r.location, r.verified],
      );
      roasterIds.set(r.slug, res.rows[0].id);
      bump('roasters');
    }

    // ---- origins (natural key: country + region) ----------------------------
    const originIds = new Map<string, string>();
    for (const o of load('origins.json') as OriginRow[]) {
      const res = await client.query(
        `INSERT INTO origins (country, region, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (country, region) DO UPDATE
           SET description = EXCLUDED.description
         RETURNING id`,
        [o.country, o.region, o.description],
      );
      originIds.set(`${o.country}|${o.region ?? ''}`, res.rows[0].id);
      bump('origins');
    }
    const originId = (key: string): string => {
      const id = originIds.get(key);
      if (!id) throw new Error(`unknown origin reference: ${key}`);
      return id;
    };

    // ---- farms (natural key: origin_id + name) ------------------------------
    const farmIds = new Map<string, string>();
    for (const f of load('farms.json') as FarmRow[]) {
      const res = await client.query(
        `INSERT INTO farms (origin_id, name, story)
         VALUES ($1, $2, $3)
         ON CONFLICT (origin_id, name) DO UPDATE SET story = EXCLUDED.story
         RETURNING id`,
        [originId(f.origin), f.name, f.story],
      );
      farmIds.set(`${f.origin}|${f.name}`, res.rows[0].id);
      bump('farms');
    }

    // ---- coffee products + their lots --------------------------------------
    // Lots have no natural key of their own; they are keyed through the owning
    // product (1:1 in seed data): if the product already has a lot, update it,
    // otherwise insert a fresh lot and attach it.
    for (const p of load('coffee_products.json') as ProductRow[]) {
      const roasterId = roasterIds.get(p.roaster);
      if (!roasterId) throw new Error(`unknown roaster reference: ${p.roaster}`);
      const lot = p.lot;
      const lotOriginId = originId(lot.origin);
      const farmId = lot.farm ? (farmIds.get(`${lot.origin}|${lot.farm}`) ?? null) : null;
      if (lot.farm && !farmId) throw new Error(`unknown farm reference: ${lot.farm}`);

      const existing = await client.query(
        'SELECT id, coffee_lot_id FROM coffee_products WHERE slug = $1',
        [p.slug],
      );
      let lotId: string;
      if (existing.rowCount && existing.rows[0].coffee_lot_id) {
        lotId = existing.rows[0].coffee_lot_id;
        await client.query(
          `UPDATE coffee_lots
             SET origin_id = $2, farm_id = $3, varietals = $4, process = $5,
                 process_detail = $6, altitude_masl = $7, harvest_period = $8
           WHERE id = $1`,
          [lotId, lotOriginId, farmId, lot.varietals, lot.process,
           lot.process_detail ?? null, lot.altitude_masl, lot.harvest_period],
        );
      } else {
        const res = await client.query(
          `INSERT INTO coffee_lots
             (origin_id, farm_id, varietals, process, process_detail,
              altitude_masl, harvest_period)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [lotOriginId, farmId, lot.varietals, lot.process,
           lot.process_detail ?? null, lot.altitude_masl, lot.harvest_period],
        );
        lotId = res.rows[0].id;
        bump('coffee_lots');
      }

      await client.query(
        `INSERT INTO coffee_products
           (roaster_id, coffee_lot_id, name, slug, roast_level, intended_use,
            tasting_notes, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (slug) DO UPDATE
           SET roaster_id = EXCLUDED.roaster_id,
               coffee_lot_id = EXCLUDED.coffee_lot_id,
               name = EXCLUDED.name, roast_level = EXCLUDED.roast_level,
               intended_use = EXCLUDED.intended_use,
               tasting_notes = EXCLUDED.tasting_notes,
               status = EXCLUDED.status`,
        [roasterId, lotId, p.name, p.slug, p.roast_level, p.intended_use,
         p.tasting_notes, p.status],
      );
      bump('coffee_products');
    }

    // ---- equipment brands + models -----------------------------------------
    const models = load('equipment.json') as ModelRow[];
    const brandIds = new Map<string, string>();
    for (const brand of [...new Set(models.map((m) => m.brand))]) {
      const res = await client.query(
        `INSERT INTO equipment_brands (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [brand],
      );
      brandIds.set(brand, res.rows[0].id);
      bump('equipment_brands');
    }

    const modelIds = new Map<string, string>();
    for (const m of models) {
      const res = await client.query(
        `INSERT INTO equipment_models
           (brand_id, category, name, slug, specs, grind_scale_type)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (slug) DO UPDATE
           SET brand_id = EXCLUDED.brand_id, category = EXCLUDED.category,
               name = EXCLUDED.name, specs = EXCLUDED.specs,
               grind_scale_type = EXCLUDED.grind_scale_type
         RETURNING id`,
        [brandIds.get(m.brand), m.category, m.name, m.slug,
         JSON.stringify(m.specs), m.grind_scale_type ?? null],
      );
      modelIds.set(m.slug, res.rows[0].id);
      bump('equipment_models');
    }
    const modelId = (slug: string): string => {
      const id = modelIds.get(slug);
      if (!id) throw new Error(`unknown equipment model reference: ${slug}`);
      return id;
    };

    // ---- seeded grind conversions ------------------------------------------
    for (const c of load('grind_conversions.json') as ConversionRow[]) {
      await client.query(
        `INSERT INTO grind_conversions
           (from_model_id, from_setting, to_model_id, to_setting, source, confidence)
         VALUES ($1, $2, $3, $4, 'seeded', $5)
         ON CONFLICT (from_model_id, from_setting, to_model_id, to_setting)
           DO UPDATE SET confidence = EXCLUDED.confidence
           WHERE grind_conversions.source = 'seeded'`, // never downgrade user_confirmed rows
        [modelId(c.from), c.from_setting, modelId(c.to), c.to_setting, c.confidence],
      );
      bump('grind_conversions');
    }

    await client.query('COMMIT');
    console.log('Seed complete (rows processed):');
    for (const [table, n] of Object.entries(counts)) {
      console.log(`  ${table.padEnd(18)} ${n}`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});
