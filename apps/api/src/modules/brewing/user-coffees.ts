/**
 * Bags on somebody's shelf (0014).
 *
 * The sibling of `user-equipment.ts`, and the reasoning is the same one: a
 * person needs to log a brew with the coffee they are actually drinking, and
 * making that wait on a catalogue is the gatekeeping the product rules out.
 *
 * ── WHAT IS DIFFERENT FROM EQUIPMENT ────────────────────────────────────────
 * A grinder is owned; a bag is CONSUMED. So this table carries a roast date and
 * a `finished_at`, and the uniqueness rules are scoped to what is still open —
 * buying the same coffee again in six months is a new bag, not a duplicate row,
 * and the two need to be distinguishable when somebody asks why their brew
 * tasted different.
 */
import type { BrewingDb } from './types.js';

export interface ShelfCoffee {
  id: string;
  /** Null when this bag has no catalogue row — private to its owner. */
  coffee_product_id: string | null;
  slug: string | null;
  name: string;
  roaster: string | null;
  roast_level: string | null;
  tasting_notes: string[];
  roast_date: string | null;
  notes: string | null;
  finished_at: string | null;
  /** Your own entry rather than a catalogue coffee. */
  is_custom: boolean;
  created_at: string;
}

const SELECT = `
  SELECT uc.id::text                          AS id,
         uc.coffee_product_id::text           AS coffee_product_id,
         cp.slug                              AS slug,
         coalesce(cp.name, uc.custom_name)    AS name,
         coalesce(r.name, uc.custom_roaster)  AS roaster,
         cp.roast_level                       AS roast_level,
         coalesce(cp.tasting_notes, '{}')     AS tasting_notes,
         uc.roast_date                        AS roast_date,
         uc.notes                             AS notes,
         uc.finished_at                       AS finished_at,
         (uc.coffee_product_id IS NULL)       AS is_custom,
         uc.created_at                        AS created_at
    FROM user_coffees uc
    LEFT JOIN coffee_products cp ON cp.id = uc.coffee_product_id
    LEFT JOIN roasters r ON r.id = cp.roaster_id`;

export async function listShelf(db: BrewingDb, userId: string): Promise<ShelfCoffee[]> {
  const { rows } = await db.query<ShelfCoffee>(
    `${SELECT} WHERE uc.user_id = $1::uuid
      ORDER BY uc.finished_at IS NOT NULL, uc.created_at DESC
      LIMIT 200`,
    [userId],
  );
  return rows;
}

export type ShelfResult =
  | { status: 'added'; item: ShelfCoffee }
  | { status: 'already_there'; item: ShelfCoffee }
  | { status: 'not_found' };

async function readOne(db: BrewingDb, id: string): Promise<ShelfCoffee | null> {
  const { rows } = await db.query<ShelfCoffee>(`${SELECT} WHERE uc.id = $1::uuid`, [id]);
  return rows[0] ?? null;
}

export interface AddShelfInput {
  userId: string;
  /** One of these two. A catalogue coffee, or a name off a bag. */
  coffeeProductId?: string | null;
  customRoaster?: string | null;
  customName?: string | null;
  roastDate?: string | null;
  notes?: string | null;
}

/**
 * Put a bag on the shelf.
 *
 * Adding the same open bag twice is a double-click, not an error — the partial
 * unique indexes in 0014 make that the database's opinion rather than this
 * function's, which is what keeps two concurrent requests honest.
 */
export async function addToShelf(db: BrewingDb, input: AddShelfInput): Promise<ShelfResult> {
  const productId = input.coffeeProductId ?? null;
  const name = input.customName?.trim() || null;

  if (productId) {
    const exists = await db.query<{ id: string }>(
      `SELECT id::text AS id FROM coffee_products WHERE id = $1::uuid`,
      [productId],
    );
    if (!exists.rows[0]) return { status: 'not_found' };
  } else if (!name) {
    return { status: 'not_found' };
  }

  const inserted = await db.query<{ id: string }>(
    `INSERT INTO user_coffees
            (user_id, coffee_product_id, custom_roaster, custom_name, roast_date, notes)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5::date, $6)
     ON CONFLICT DO NOTHING
       RETURNING id::text AS id`,
    [
      input.userId,
      productId,
      productId ? null : (input.customRoaster?.trim() || null),
      productId ? null : name,
      input.roastDate ?? null,
      input.notes?.trim() || null,
    ],
  );

  const id = inserted.rows[0]?.id;
  if (id) {
    const item = await readOne(db, id);
    return item ? { status: 'added', item } : { status: 'not_found' };
  }

  // The conflict target is "this bag, still open". Two shapes, and each passes
  // exactly the parameters its own statement mentions — a spare placeholder is
  // not merely untidy, Postgres refuses the statement outright.
  const existing = productId
    ? await db.query<{ id: string }>(
        `SELECT id::text AS id FROM user_coffees
          WHERE user_id = $1::uuid AND coffee_product_id = $2::uuid AND finished_at IS NULL`,
        [input.userId, productId],
      )
    : await db.query<{ id: string }>(
        `SELECT id::text AS id FROM user_coffees
          WHERE user_id = $1::uuid AND coffee_product_id IS NULL
            AND lower(coalesce(custom_roaster, '')) = lower(coalesce($2, ''))
            AND lower(custom_name) = lower($3)
            AND finished_at IS NULL`,
        [input.userId, input.customRoaster?.trim() ?? null, name],
      );
  const found = existing.rows[0]?.id;
  if (!found) return { status: 'not_found' };
  const item = await readOne(db, found);
  return item ? { status: 'already_there', item } : { status: 'not_found' };
}

/** Finished the bag. Kept rather than deleted: past brews still refer to it. */
export async function finishBag(db: BrewingDb, userId: string, id: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE user_coffees SET finished_at = now()
      WHERE id = $1::uuid AND user_id = $2::uuid AND finished_at IS NULL
      RETURNING id::text AS id`,
    [id, userId],
  );
  return rows.length > 0;
}

/** Removes it outright — for the mis-scan, not the empty bag. */
export async function removeFromShelf(
  db: BrewingDb,
  userId: string,
  id: string,
): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM user_coffees WHERE id = $1::uuid AND user_id = $2::uuid RETURNING id::text AS id`,
    [id, userId],
  );
  return rows.length > 0;
}
