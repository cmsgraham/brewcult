/**
 * Where to buy a coffee, and what it costs (0018).
 *
 * ── TWO CURRENCIES, NEITHER DERIVED ─────────────────────────────────────────
 * Colones and dollars are both stored as quoted. Nothing here converts one into
 * the other, and nothing should: a stored conversion is a lie with a timestamp,
 * because the rate moves and the shop's dollar price does not follow it. If a
 * vendor quotes only one currency, the other stays null and the page shows one
 * price — which is the truth.
 *
 * ── A PRICE IS A CLAIM ABOUT A MOMENT ───────────────────────────────────────
 * `quoted_on` travels with every offer and is rendered next to it. Without a
 * date the oldest number on the page looks exactly like the newest, and a
 * catalogue of confidently wrong prices is worse than no prices at all.
 */
import { badRequest } from '../../lib/errors.js';
import type { CatalogDb } from './repository.js';
import { slugify } from './text.js';

export interface VendorContact {
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  maps_url: string | null;
  shop_url: string | null;
}

export interface Vendor extends VendorContact {
  id: string;
  name: string;
  slug: string;
  location: string | null;
  verified: boolean;
  roaster_id: string | null;
}

export interface CoffeeOffer {
  id: string;
  vendor: Vendor;
  size_grams: number;
  price_crc: number | null;
  price_usd: number | null;
  /** Comparable across sizes. Computed here, never stored — it is arithmetic. */
  price_crc_per_kg: number | null;
  price_usd_per_kg: number | null;
  url: string | null;
  in_stock: boolean;
  quoted_on: string;
}

const CONTACT_FIELDS = [
  'phone',
  'whatsapp',
  'email',
  'website_url',
  'instagram_url',
  'facebook_url',
  'maps_url',
  'shop_url',
] as const;

/**
 * http(s) only.
 *
 * A `javascript:` or `data:` URL in a link somebody else clicks is the oldest
 * trick there is, and these links are typed by one member for others to follow.
 * The database enforces the same rule; this exists so the answer is a sentence
 * rather than a constraint name.
 */
function assertWebUrl(value: string, field: string): string {
  const trimmed = value.trim();
  // Shape and length checked separately, matching `is_web_url()` in 0019. The
  // combined form was what tripped Postgres — its regex engine caps repetition
  // at 255, so `{3,300}` was a syntax error rather than a large number.
  if (!/^https?:\/\/[^\s]{3,}$/i.test(trimmed) || trimmed.length > 300) {
    throw badRequest(`${field.replace(/_/g, ' ')} must be a full http:// or https:// address.`);
  }
  return trimmed;
}

export interface VendorInput {
  name: string;
  location?: string | null;
  roasterId?: string | null;
  submittedBy?: string | null;
  contact?: Partial<VendorContact>;
}

/** Find or create a vendor by name, UNVERIFIED — same rule as roasters. */
export async function upsertVendor(
  db: CatalogDb,
  input: VendorInput,
): Promise<{ id: string; created: boolean }> {
  const name = input.name.trim();
  if (name === '') throw badRequest('What is the shop called?');
  if (name.length > 120) throw badRequest('That name is a bit long — 120 characters or fewer.');

  const existing = await db.query<{ id: string }>(
    `SELECT id::text AS id FROM vendors WHERE lower(name) = lower($1) LIMIT 1`,
    [name],
  );
  const found = existing.rows[0]?.id;
  if (found) {
    await updateVendorContact(db, found, input.contact ?? {});
    return { id: found, created: false };
  }

  const base = slugify(name);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      const created = await db.query<{ id: string }>(
        `INSERT INTO vendors (name, slug, location, roaster_id, source, submitted_by)
              VALUES ($1, $2, $3, $4::uuid, 'community', $5::uuid)
           RETURNING id::text AS id`,
        [name, slug, input.location?.trim() || null, input.roasterId ?? null, input.submittedBy ?? null],
      );
      const id = created.rows[0]!.id;
      await updateVendorContact(db, id, input.contact ?? {});
      return { id, created: true };
    } catch (err) {
      if (!/unique|duplicate/i.test((err as Error).message)) throw err;
    }
  }
  throw badRequest('Could not find a free address for that shop.');
}

/**
 * Set the ways to reach a vendor.
 *
 * Only the fields SUPPLIED are touched. Passing an empty object leaves every
 * contact detail alone, which is what makes `upsertVendor` safe to call on an
 * existing shop: adding an offer must never blank out somebody's phone number
 * because this caller did not happen to know it.
 */
export async function updateVendorContact(
  db: CatalogDb,
  vendorId: string,
  contact: Partial<VendorContact>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [vendorId];

  for (const field of CONTACT_FIELDS) {
    const raw = contact[field];
    if (raw === undefined) continue;
    let value: string | null = null;
    if (raw !== null && raw.trim() !== '') {
      value = field.endsWith('_url') ? assertWebUrl(raw, field) : raw.trim();
      if (!field.endsWith('_url') && value.length > 40 && field !== 'email') {
        throw badRequest(`${field} is a bit long — 40 characters or fewer.`);
      }
    }
    values.push(value);
    sets.push(`${field} = $${values.length}`);
  }
  if (sets.length === 0) return;

  await db.query(`UPDATE vendors SET ${sets.join(', ')} WHERE id = $1::uuid`, values);
}

const VENDOR_COLUMNS = `
  v.id::text        AS id,
  v.name            AS name,
  v.slug            AS slug,
  v.location        AS location,
  v.verified        AS verified,
  v.roaster_id::text AS roaster_id,
  v.phone, v.whatsapp, v.email::text AS email,
  v.website_url, v.instagram_url, v.facebook_url, v.maps_url, v.shop_url`;

export async function findVendor(db: CatalogDb, id: string): Promise<Vendor | null> {
  const { rows } = await db.query<Vendor>(
    `SELECT ${VENDOR_COLUMNS} FROM vendors v WHERE v.id = $1::uuid`,
    [id],
  );
  return rows[0] ?? null;
}

export interface OfferInput {
  coffeeProductId: string;
  vendorId: string;
  sizeGrams: number;
  priceCrc?: number | null;
  priceUsd?: number | null;
  url?: string | null;
  inStock?: boolean;
  submittedBy?: string | null;
}

/** Record what a shop charges. A second offer for the same size is an update. */
export async function upsertOffer(db: CatalogDb, input: OfferInput): Promise<void> {
  if (!Number.isInteger(input.sizeGrams) || input.sizeGrams < 10 || input.sizeGrams > 20_000) {
    throw badRequest('Bag size in grams, somewhere between 10 and 20000.');
  }
  const crc = input.priceCrc ?? null;
  const usd = input.priceUsd ?? null;
  if (crc === null && usd === null) {
    throw badRequest('Give a price in colones, in dollars, or both.');
  }
  for (const [label, value] of [
    ['colones', crc],
    ['dollars', usd],
  ] as const) {
    if (value === null) continue;
    if (!Number.isFinite(value) || value < 0) throw badRequest(`The price in ${label} looks wrong.`);
  }
  const url = input.url?.trim() ? assertWebUrl(input.url, 'link') : null;

  await db.query(
    `INSERT INTO coffee_offers
            (coffee_product_id, vendor_id, size_grams, price_crc, price_usd, url, in_stock,
             quoted_on, submitted_by)
          VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, coalesce($7::boolean, true),
                  current_date, $8::uuid)
     ON CONFLICT (coffee_product_id, vendor_id, size_grams)
     DO UPDATE SET price_crc = EXCLUDED.price_crc,
                   price_usd = EXCLUDED.price_usd,
                   url = EXCLUDED.url,
                   in_stock = EXCLUDED.in_stock,
                   -- The date moves with the PRICE. An offer re-confirmed today
                   -- is today's price, which is the whole point of recording it.
                   quoted_on = current_date`,
    [
      input.coffeeProductId,
      input.vendorId,
      input.sizeGrams,
      crc,
      usd,
      url,
      input.inStock ?? null,
      input.submittedBy ?? null,
    ],
  );
}

/** Every offer for a coffee, cheapest per kilo first. */
export async function listOffers(
  db: CatalogDb,
  coffeeProductId: string,
): Promise<CoffeeOffer[]> {
  const { rows } = await db.query<{
    id: string;
    size_grams: number;
    price_crc: string | null;
    price_usd: string | null;
    url: string | null;
    in_stock: boolean;
    quoted_on: string | Date;
    vendor: Vendor;
  }>(
    `SELECT o.id::text     AS id,
            o.size_grams   AS size_grams,
            o.price_crc::text AS price_crc,
            o.price_usd::text AS price_usd,
            o.url          AS url,
            o.in_stock     AS in_stock,
            o.quoted_on    AS quoted_on,
            jsonb_build_object(
              'id', v.id::text, 'name', v.name, 'slug', v.slug, 'location', v.location,
              'verified', v.verified, 'roaster_id', v.roaster_id::text,
              'phone', v.phone, 'whatsapp', v.whatsapp, 'email', v.email::text,
              'website_url', v.website_url, 'instagram_url', v.instagram_url,
              'facebook_url', v.facebook_url, 'maps_url', v.maps_url, 'shop_url', v.shop_url
            )              AS vendor
       FROM coffee_offers o
       JOIN vendors v ON v.id = o.vendor_id
      WHERE o.coffee_product_id = $1::uuid
      ORDER BY o.in_stock DESC,
               -- Per kilo, so a 1kg bag and a 250g one can be compared. Sorted
               -- in SQL on whichever currency the row actually carries.
               coalesce(o.price_crc / o.size_grams, o.price_usd / o.size_grams) ASC
      LIMIT 50`,
    [coffeeProductId],
  );

  return rows.map((row) => {
    const crc = row.price_crc === null ? null : Number(row.price_crc);
    const usd = row.price_usd === null ? null : Number(row.price_usd);
    const perKg = (value: number | null): number | null =>
      value === null ? null : Math.round((value / row.size_grams) * 1000 * 100) / 100;
    return {
      id: row.id,
      vendor: row.vendor,
      size_grams: row.size_grams,
      price_crc: crc,
      price_usd: usd,
      price_crc_per_kg: perKg(crc),
      price_usd_per_kg: perKg(usd),
      url: row.url,
      in_stock: row.in_stock,
      // `date` arrives as a Date object, and String(Date) is "Thu Aug 06 2026
      // …" — slicing ten characters off THAT gives "Thu Aug 06". ISO first.
      quoted_on:
        row.quoted_on instanceof Date
          ? row.quoted_on.toISOString().slice(0, 10)
          : String(row.quoted_on).slice(0, 10),
    };
  });
}

export async function deleteOffer(db: CatalogDb, id: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM coffee_offers WHERE id = $1::uuid RETURNING id::text AS id`,
    [id],
  );
  return rows.length > 0;
}
