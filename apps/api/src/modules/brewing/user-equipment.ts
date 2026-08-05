/**
 * The gear a person owns.
 *
 * Lives in `brewing` rather than `catalog` because it is user-scoped state
 * about brewing, exactly like brew sessions — the catalogue stays the public,
 * shared description of what a device IS. A row here is a FK into it, so specs
 * and grind-scale types are never copied and can never drift.
 *
 * Why it exists at all when 0006 already records equipment per brew: derivation
 * fails for a new user (nothing logged yet, which is when advice matters most),
 * for gear owned but rarely used, and for gear that was sold. See the 0010
 * header.
 */
import type { BrewingDb } from './types.js';

export type EquipmentCategory =
  | 'brewer'
  | 'grinder'
  | 'kettle'
  | 'scale'
  | 'machine'
  | 'accessory';

export interface OwnedEquipment {
  id: string;
  equipment_model_id: string;
  slug: string;
  name: string;
  brand: string;
  category: EquipmentCategory;
  grind_scale_type: string | null;
  nickname: string | null;
  is_primary: boolean;
  created_at: string;
}

const SELECT = `
  SELECT ue.id::text                 AS id,
         ue.equipment_model_id::text AS equipment_model_id,
         em.slug                     AS slug,
         em.name                     AS name,
         eb.name                     AS brand,
         em.category                 AS category,
         em.grind_scale_type         AS grind_scale_type,
         ue.nickname                 AS nickname,
         ue.is_primary               AS is_primary,
         ue.created_at               AS created_at
    FROM user_equipment ue
    JOIN equipment_models em ON em.id = ue.equipment_model_id
    JOIN equipment_brands eb ON eb.id = em.brand_id`;

/** Everything this person owns, newest first. */
export async function listOwnedEquipment(
  db: BrewingDb,
  userId: string,
): Promise<OwnedEquipment[]> {
  const res = await db.query<OwnedEquipment>(
    `${SELECT} WHERE ue.user_id = $1::uuid ORDER BY ue.created_at DESC, ue.id DESC`,
    [userId],
  );
  return res.rows;
}

/** One row, scoped to its owner — so a wrong id reads as "not yours", not 404. */
export async function findOwnedEquipment(
  db: BrewingDb,
  userId: string,
  id: string,
): Promise<OwnedEquipment | null> {
  const res = await db.query<OwnedEquipment>(
    `${SELECT} WHERE ue.user_id = $1::uuid AND ue.id = $2::uuid`,
    [userId, id],
  );
  return res.rows[0] ?? null;
}

export interface AddEquipmentInput {
  userId: string;
  equipmentModelId: string;
  nickname?: string | null;
  isPrimary?: boolean;
}

export type AddResult =
  | { status: 'added'; item: OwnedEquipment }
  | { status: 'already_owned' }
  | { status: 'unknown_model' };

/**
 * Claim ownership of a catalogue model.
 *
 * The category is read from the catalogue and written into `primary_category`
 * so the partial unique index can enforce one primary per category. Doing that
 * in SQL rather than trusting a caller-supplied value means a client cannot
 * declare a grinder to be a kettle and end up with two "primary" grinders.
 */
export async function addOwnedEquipment(
  db: BrewingDb,
  input: AddEquipmentInput,
): Promise<AddResult> {
  const model = await db.query<{ id: string; category: EquipmentCategory }>(
    `SELECT id::text AS id, category FROM equipment_models WHERE id = $1::uuid`,
    [input.equipmentModelId],
  );
  const category = model.rows[0]?.category;
  if (!category) return { status: 'unknown_model' };

  const isPrimary = input.isPrimary === true;
  if (isPrimary) {
    // Demote the incumbent first: the index forbids two, so without this the
    // insert would fail rather than doing what the person asked.
    await db.query(
      `UPDATE user_equipment
          SET is_primary = false, primary_category = NULL
        WHERE user_id = $1::uuid AND primary_category = $2`,
      [input.userId, category],
    );
  }

  const inserted = await db.query<{ id: string }>(
    `INSERT INTO user_equipment
       (user_id, equipment_model_id, nickname, is_primary, primary_category)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5)
     ON CONFLICT (user_id, equipment_model_id) DO NOTHING
     RETURNING id::text AS id`,
    [
      input.userId,
      input.equipmentModelId,
      input.nickname?.trim() || null,
      isPrimary,
      isPrimary ? category : null,
    ],
  );

  const id = inserted.rows[0]?.id;
  if (!id) return { status: 'already_owned' };

  const item = await findOwnedEquipment(db, input.userId, id);
  return item ? { status: 'added', item } : { status: 'already_owned' };
}

/** Mark one item primary for its category, clearing whatever held the slot. */
export async function setPrimaryEquipment(
  db: BrewingDb,
  userId: string,
  id: string,
): Promise<OwnedEquipment | null> {
  const current = await findOwnedEquipment(db, userId, id);
  if (!current) return null;

  await db.query(
    `UPDATE user_equipment
        SET is_primary = false, primary_category = NULL
      WHERE user_id = $1::uuid AND primary_category = $2 AND id <> $3::uuid`,
    [userId, current.category, id],
  );
  await db.query(
    `UPDATE user_equipment
        SET is_primary = true, primary_category = $2
      WHERE user_id = $1::uuid AND id = $3::uuid`,
    [userId, current.category, id],
  );
  return findOwnedEquipment(db, userId, id);
}

/** Give it up. Scoped by user_id, so one person cannot delete another's row. */
export async function removeOwnedEquipment(
  db: BrewingDb,
  userId: string,
  id: string,
): Promise<boolean> {
  const res = await db.query<{ id: string }>(
    `DELETE FROM user_equipment
      WHERE user_id = $1::uuid AND id = $2::uuid
      RETURNING id::text AS id`,
    [userId, id],
  );
  return res.rows.length > 0;
}
