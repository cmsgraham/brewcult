/**
 * Notes on a coffee (0016), against a real Postgres engine.
 *
 * The rules worth pinning are the social ones, because they are the ones a
 * handler can quietly stop enforcing:
 *
 *   - one note per person, edited in place rather than stacked
 *   - nobody votes their own note useful, enforced by the DATABASE
 *   - a hidden note is invisible to readers and absent from the average
 *   - your own note comes first, or you write it again thinking it was lost
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  deleteCoffeeReview,
  hideCoffeeReview,
  listCoffeeReviews,
  ratingSummary,
  toggleHelpful,
  upsertCoffeeReview,
} from '../src/modules/catalog/coffee-reviews.js';
import type { CatalogDb } from '../src/modules/catalog/repository.js';
import { listOffers, upsertOffer, upsertVendor } from '../src/modules/catalog/offers.js';
import { normaliseTastingNotes } from '../src/modules/intelligence/coffee-draft.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const MIGRATIONS = [
  'db/migrations/0001_extensions.sql',
  'db/migrations/0002_identity.sql',
  'db/migrations/0003_catalog.sql',
  'db/migrations/0005_identity_extras.sql',
  'db/migrations/0006_brewing.sql',
  'db/migrations/0008_media.sql',
  'db/migrations/0014_community_coffee.sql',
  'db/migrations/0016_coffee_reviews.sql',
  'db/migrations/0017_sca_cupping.sql',
  'db/migrations/0018_vendors_and_prices.sql',
  'db/migrations/0019_fix_url_checks.sql',
];

let pg: PGlite;
let db: CatalogDb;
let coffeeId = '';
let alice = '';
let bob = '';
let carol = '';

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
  } as CatalogDb;

  const mk = async (email: string, handle: string): Promise<string> =>
    (
      await pg.query<{ id: string }>(
        `INSERT INTO users (email, handle, password_hash, email_verified_at)
              VALUES ($1, $2, 'x', now()) RETURNING id::text AS id`,
        [email, handle],
      )
    ).rows[0]!.id;
  alice = await mk('alice@brewcult.test', 'alicedrinks');
  bob = await mk('bob@brewcult.test', 'bobdrinks');
  carol = await mk('carol@brewcult.test', 'caroldrinks');

  const roaster = await pg.query<{ id: string }>(
    `INSERT INTO roasters (name, slug) VALUES ('Onyx Coffee Lab', 'onyx-coffee-lab')
     RETURNING id::text AS id`,
  );
  const coffee = await pg.query<{ id: string }>(
    `INSERT INTO coffee_products (roaster_id, name, slug, roast_level, intended_use)
          VALUES ($1::uuid, 'Ethiopia Guji', 'onyx-ethiopia-guji', 'light', 'filter')
       RETURNING id::text AS id`,
    [roaster.rows[0]!.id],
  );
  coffeeId = coffee.rows[0]!.id;
}, 180_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await pg.query('DELETE FROM coffee_reviews');
});

describe('leaving a note', () => {
  it('records the rating and shows it back', async () => {
    const review = await upsertCoffeeReview(db, {
      coffeeProductId: coffeeId,
      userId: alice,
      overall: 8,
      body: 'Peachy, best at 1:16.',
      brewMethod: 'V60',
    });
    expect(review).toMatchObject({
      overall: 8,
      body: 'Peachy, best at 1:16.',
      brew_method: 'V60',
      is_mine: true,
      helpful_count: 0,
    });
  });

  it('EDITS rather than stacking a second note', async () => {
    await upsertCoffeeReview(db, { coffeeProductId: coffeeId, userId: alice, overall: 6.5 });
    await upsertCoffeeReview(db, {
      coffeeProductId: coffeeId,
      userId: alice,
      overall: 9,
      body: 'Ground finer, completely different coffee.',
    });

    const items = await listCoffeeReviews(db, coffeeId, alice);
    // A thread where one person can post fifteen times is a thread the loudest
    // person wins.
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ overall: 9 });
  });

  it('refuses a score off the SCA scale', async () => {
    // 5.75 is below the specialty floor, 10.25 above the ceiling, 8.3 is not a
    // quarter point. The protocol admits none of them.
    for (const overall of [5.75, 10.25, 8.3, 0, Number.NaN]) {
      await expect(
        upsertCoffeeReview(db, { coffeeProductId: coffeeId, userId: alice, overall }),
      ).rejects.toThrow();
    }
  });

  it('computes a cupping score only from a COMPLETE form', async () => {
    const partial = await upsertCoffeeReview(db, {
      coffeeProductId: coffeeId,
      userId: alice,
      overall: 8,
      attributes: { flavour: 8.5, acidity: 8.25 },
    });
    // Nine of ten is not a score out of 100. Treating a missing attribute as
    // zero would rank every honest partial form below every complete one.
    expect(partial.total_score).toBeNull();

    const full = await upsertCoffeeReview(db, {
      coffeeProductId: coffeeId,
      userId: alice,
      overall: 8,
      attributes: {
        fragrance_aroma: 8,
        flavour: 8,
        aftertaste: 8,
        acidity: 8,
        body_score: 8,
        uniformity: 10,
        balance: 8,
        clean_cup: 10,
        sweetness: 10,
      },
    });
    expect(full.total_score).toBe(86);
  });

  it('subtracts taints and faults the way the protocol does', async () => {
    const scored = await upsertCoffeeReview(db, {
      coffeeProductId: coffeeId,
      userId: alice,
      overall: 8,
      attributes: {
        fragrance_aroma: 8,
        flavour: 8,
        aftertaste: 8,
        acidity: 8,
        body_score: 8,
        uniformity: 10,
        balance: 8,
        clean_cup: 10,
        sweetness: 10,
      },
      taintCups: 1, // 2 points each
      faultCups: 1, // 4 points each
    });
    expect(scored.total_score).toBe(80);
  });

  it('lets you take your own note back', async () => {
    const review = await upsertCoffeeReview(db, {
      coffeeProductId: coffeeId,
      userId: alice,
      overall: 7,
    });
    expect(await deleteCoffeeReview(db, review.id, bob)).toBe(false); // not bob's
    expect(await deleteCoffeeReview(db, review.id, alice)).toBe(true);
    expect(await listCoffeeReviews(db, coffeeId, alice)).toHaveLength(0);
  });
});

describe('the number on the card', () => {
  it('averages what people said', async () => {
    await upsertCoffeeReview(db, { coffeeProductId: coffeeId, userId: alice, overall: 9 });
    await upsertCoffeeReview(db, { coffeeProductId: coffeeId, userId: bob, overall: 8 });
    await upsertCoffeeReview(db, { coffeeProductId: coffeeId, userId: carol, overall: 7 });

    // The average OVERALL, because that is the number every note carries.
    expect(await ratingSummary(db, coffeeId)).toMatchObject({
      average_overall: 8,
      count: 3,
      cupped_count: 0,
      average_cupping: null,
    });
  });

  it('says nothing rather than zero when nobody has rated it', async () => {
    // A coffee showing "0 out of 5" reads as "everybody hated this", not as
    // "nobody has tried it".
    expect(await ratingSummary(db, coffeeId)).toEqual({
      average_overall: null,
      average_cupping: null,
      cupped_count: 0,
      count: 0,
    });
  });

  it('excludes a hidden note from the average as well as the list', async () => {
    const bad = await upsertCoffeeReview(db, {
      coffeeProductId: coffeeId,
      userId: alice,
      overall: 6,
      body: 'something abusive',
    });
    await upsertCoffeeReview(db, { coffeeProductId: coffeeId, userId: bob, overall: 9 });

    expect(await hideCoffeeReview(db, bad.id, carol, 'abuse')).toBe(true);
    expect(await ratingSummary(db, coffeeId)).toMatchObject({ average_overall: 9, count: 1 });
    expect(await listCoffeeReviews(db, coffeeId, alice)).toHaveLength(1);
  });
});

describe('marking a note useful', () => {
  it('toggles on and off', async () => {
    const review = await upsertCoffeeReview(db, {
      coffeeProductId: coffeeId,
      userId: alice,
      overall: 8,
    });

    expect(await toggleHelpful(db, review.id, bob)).toBe('added');
    let seen = (await listCoffeeReviews(db, coffeeId, bob))[0]!;
    expect(seen).toMatchObject({ helpful_count: 1, voted_helpful: true });

    expect(await toggleHelpful(db, review.id, bob)).toBe('removed');
    seen = (await listCoffeeReviews(db, coffeeId, bob))[0]!;
    expect(seen).toMatchObject({ helpful_count: 0, voted_helpful: false });
  });

  it('refuses your own note, in the handler AND in the database', async () => {
    const review = await upsertCoffeeReview(db, {
      coffeeProductId: coffeeId,
      userId: alice,
      overall: 8,
    });
    expect(await toggleHelpful(db, review.id, alice)).toBe('own_review');

    // The trigger is the real guard: no sequence of API calls, migrations or
    // console pokes should be able to produce a self-vote row.
    await expect(
      pg.query(`INSERT INTO coffee_review_votes (review_id, user_id) VALUES ($1::uuid, $2::uuid)`, [
        review.id,
        alice,
      ]),
    ).rejects.toThrow(/cannot be voted useful by the person who wrote it/);
  });

  it('counts one vote per person however many times they click', async () => {
    const review = await upsertCoffeeReview(db, {
      coffeeProductId: coffeeId,
      userId: alice,
      overall: 8,
    });
    await toggleHelpful(db, review.id, bob);
    await pg.query(
      `INSERT INTO coffee_review_votes (review_id, user_id) VALUES ($1::uuid, $2::uuid)
       ON CONFLICT DO NOTHING`,
      [review.id, bob],
    );
    expect((await listCoffeeReviews(db, coffeeId, bob))[0]?.helpful_count).toBe(1);
  });
});

describe('the order notes appear in', () => {
  it('puts YOUR note first, whatever the votes say', async () => {
    const popular = await upsertCoffeeReview(db, {
      coffeeProductId: coffeeId,
      userId: bob,
      overall: 9,
    });
    await toggleHelpful(db, popular.id, carol);
    await upsertCoffeeReview(db, { coffeeProductId: coffeeId, userId: alice, overall: 7 });

    // Somebody who cannot find what they just wrote assumes it did not save,
    // and writes it again.
    const seen = await listCoffeeReviews(db, coffeeId, alice);
    expect(seen[0]?.is_mine).toBe(true);
    expect(seen[1]?.helpful_count).toBe(1);
  });

  it('sorts everyone else by usefulness for a stranger', async () => {
    const quiet = await upsertCoffeeReview(db, {
      coffeeProductId: coffeeId,
      userId: alice,
      overall: 6.5,
    });
    const useful = await upsertCoffeeReview(db, {
      coffeeProductId: coffeeId,
      userId: bob,
      overall: 9,
    });
    await toggleHelpful(db, useful.id, carol);

    const seen = await listCoffeeReviews(db, coffeeId, null);
    expect(seen[0]?.id).toBe(useful.id);
    expect(seen[1]?.id).toBe(quiet.id);
    // Anonymous readers get null, not false: "unknown", not "you did not".
    expect(seen[0]?.voted_helpful).toBeNull();
    expect(seen[0]?.is_mine).toBe(false);
  });
});

describe('tasting notes read off a bag', () => {
  it('splits the prose a real submission came back with', () => {
    // Verbatim from production: one "note" containing four.
    expect(
      normaliseTastingNotes([
        'smooth balance of chocolate and citrus flavors, with subtle hints of caramel and almond',
      ]),
    ).toEqual(['chocolate', 'citrus', 'caramel', 'almond']);
  });

  it('leaves notes that were already notes alone', () => {
    expect(normaliseTastingNotes(['milk chocolate', 'black tea', 'peach'])).toEqual([
      'milk chocolate',
      'black tea',
      'peach',
    ]);
  });

  it('drops what is still a sentence afterwards', () => {
    const out = normaliseTastingNotes([
      'this coffee is best enjoyed on a sunny afternoon with friends',
    ]);
    for (const note of out) expect(note.split(/\s+/).length).toBeLessThanOrEqual(3);
  });

  it('does not repeat itself', () => {
    expect(normaliseTastingNotes(['chocolate, chocolate and Chocolate'])).toEqual(['chocolate']);
  });

  /**
   * Most bags photographed on this site are printed in Spanish, and the
   * function only ever understood English — " y " is not " and ", so the whole
   * prose survived as a single chip reading "notas de chocolate y caramelo".
   *
   * The notes are stored exactly as the roaster printed them and shown
   * unchanged in both languages, so getting this wrong is not a formatting
   * problem: it puts words in a roaster's mouth, or drops theirs entirely.
   */
  it('splits the same prose in Spanish', () => {
    expect(
      normaliseTastingNotes(['suave balance de chocolate y cítricos, con notas de caramelo']),
    ).toEqual(['chocolate', 'cítricos', 'caramelo']);
  });

  it('strips Spanish filler without eating the note', () => {
    expect(
      normaliseTastingNotes(['notas de almendra', 'toques de miel', 'con sabores a nuez']),
    ).toEqual(['almendra', 'miel', 'nuez']);
  });

  it('keeps a Spanish note that is already a note', () => {
    expect(normaliseTastingNotes(['chocolate de leche', 'frutos rojos', 'panela'])).toEqual([
      'chocolate de leche',
      'frutos rojos',
      'panela',
    ]);
  });

  it('handles "e" before an i- word', () => {
    expect(normaliseTastingNotes(['chocolate e higos'])).toEqual(['chocolate', 'higos']);
  });
});

/**
 * Prices and the shops that quote them (0018).
 *
 * The rule under test throughout: nothing converts one currency into the other.
 * A stored conversion is a lie with a timestamp — the rate moves, the shop's
 * dollar price does not follow it, and a computed colón figure drifts from the
 * number on the shelf while looking authoritative.
 */
describe('where to buy it', () => {
  beforeEach(async () => {
    await pg.query('DELETE FROM coffee_offers');
    await pg.query('DELETE FROM vendors');
  });

  it('records both currencies as quoted, and neither from the other', async () => {
    const vendor = await upsertVendor(db, { name: 'Café Rescate', location: 'San José' });
    await upsertOffer(db, {
      coffeeProductId: coffeeId,
      vendorId: vendor.id,
      sizeGrams: 340,
      priceCrc: 8500,
      priceUsd: 16.5,
    });

    const [offer] = await listOffers(db, coffeeId);
    expect(offer).toMatchObject({ price_crc: 8500, price_usd: 16.5, size_grams: 340 });
    // A `date` column arrives as a Date object; String(Date) starts "Thu Aug 06",
    // so slicing ten characters off it produced a weekday instead of a date.
    expect(offer?.quoted_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Per kilo is arithmetic on one row, so it IS computed — that is a
    // different thing from inventing a price in a currency nobody quoted.
    expect(offer?.price_crc_per_kg).toBe(25000);
  });

  it('takes one currency on its own, and approximates the other at read time', async () => {
    const vendor = await upsertVendor(db, { name: 'Solo Colones' });
    await upsertOffer(db, {
      coffeeProductId: coffeeId,
      vendorId: vendor.id,
      sizeGrams: 250,
      priceCrc: 6000,
    });
    const [offer] = await listOffers(db, coffeeId);
    // The QUOTED dollar price stays null — nothing is stored in a currency the
    // shop never quoted. The approximation is a separate field, computed at
    // read time (₡510/$ default), so it always reflects the current rate
    // rather than the rate of the day the offer was typed.
    expect(offer?.price_usd).toBeNull();
    expect(offer?.price_usd_per_kg).toBeNull();
    expect(offer?.price_usd_approx).toBeCloseTo(6000 / 510, 2);
    expect(offer?.fx_crc_per_usd).toBe(510);
  });

  it('approximates nothing when both currencies were quoted', async () => {
    const vendor = await upsertVendor(db, { name: 'Both Currencies' });
    await upsertOffer(db, {
      coffeeProductId: coffeeId,
      vendorId: vendor.id,
      sizeGrams: 340,
      priceCrc: 8500,
      priceUsd: 16.5,
    });
    const [offer] = await listOffers(db, coffeeId);
    // Two real numbers need no third opinion.
    expect(offer?.price_usd_approx).toBeNull();
    expect(offer?.price_crc_approx).toBeNull();
    expect(offer?.fx_crc_per_usd).toBeNull();
  });

  it('refuses an offer with no price at all', async () => {
    const vendor = await upsertVendor(db, { name: 'No Price' });
    await expect(
      upsertOffer(db, { coffeeProductId: coffeeId, vendorId: vendor.id, sizeGrams: 340 }),
    ).rejects.toThrow();
  });

  it('updates rather than duplicating the same shop and size', async () => {
    const vendor = await upsertVendor(db, { name: 'Café Rescate' });
    const input = { coffeeProductId: coffeeId, vendorId: vendor.id, sizeGrams: 340 };
    await upsertOffer(db, { ...input, priceCrc: 8500 });
    await upsertOffer(db, { ...input, priceCrc: 9200 });

    const offers = await listOffers(db, coffeeId);
    expect(offers).toHaveLength(1);
    expect(offers[0]?.price_crc).toBe(9200);
  });

  it('keeps two sizes from the same shop apart', async () => {
    const vendor = await upsertVendor(db, { name: 'Café Rescate' });
    await upsertOffer(db, { coffeeProductId: coffeeId, vendorId: vendor.id, sizeGrams: 340, priceCrc: 8500 });
    await upsertOffer(db, { coffeeProductId: coffeeId, vendorId: vendor.id, sizeGrams: 1000, priceCrc: 22000 });

    const offers = await listOffers(db, coffeeId);
    expect(offers).toHaveLength(2);
    // Cheapest per kilo first, which is the only fair way to order two sizes.
    expect(offers[0]?.size_grams).toBe(1000);
  });

  it('mints a vendor UNVERIFIED, and treats capitalisation as one shop', async () => {
    const first = await upsertVendor(db, { name: 'Café Rescate' });
    const second = await upsertVendor(db, { name: 'café rescate' });
    expect(second.id).toBe(first.id);

    const { rows } = await pg.query<{ verified: boolean; source: string }>(
      `SELECT verified, source FROM vendors WHERE id = $1::uuid`,
      [first.id],
    );
    expect(rows[0]).toMatchObject({ verified: false, source: 'community' });
  });

  it('STORES a good link and reads it back', async () => {
    // The acceptance path had no test, so a CHECK constraint that could never
    // pass shipped: Postgres caps a regex repetition count at 255 and 0018 asked
    // for {3,300}, which is a syntax error rather than a big number. Every
    // insert carrying a URL 500'd, and every test only exercised the refusal.
    const vendor = await upsertVendor(db, {
      name: 'Linked Shop',
      contact: {
        website_url: 'https://example.com',
        instagram_url: 'https://instagram.com/example',
        maps_url: 'https://maps.app.goo.gl/abc',
      },
    });
    await upsertOffer(db, {
      coffeeProductId: coffeeId,
      vendorId: vendor.id,
      sizeGrams: 340,
      priceCrc: 8500,
      url: 'https://example.com/the-coffee',
    });

    const [offer] = await listOffers(db, coffeeId);
    expect(offer?.url).toBe('https://example.com/the-coffee');
    expect(offer?.vendor).toMatchObject({
      website_url: 'https://example.com',
      instagram_url: 'https://instagram.com/example',
    });
  });

  it('refuses a link that is not http(s)', async () => {
    // These links are typed by one member for others to click.
    await expect(
      upsertVendor(db, { name: 'Sketchy', contact: { website_url: 'javascript:alert(1)' } }),
    ).rejects.toThrow();
    await expect(
      upsertVendor(db, { name: 'Sketchy Two', contact: { maps_url: 'data:text/html,hi' } }),
    ).rejects.toThrow();
  });

  it('does not blank a phone number just because this caller did not know it', async () => {
    const vendor = await upsertVendor(db, {
      name: 'Café Rescate',
      contact: { phone: '2222-2222', whatsapp: '8888-8888' },
    });
    // A second offer from somebody who only knows the name.
    await upsertVendor(db, { name: 'Café Rescate' });

    const { rows } = await pg.query<{ phone: string | null; whatsapp: string | null }>(
      `SELECT phone, whatsapp FROM vendors WHERE id = $1::uuid`,
      [vendor.id],
    );
    expect(rows[0]).toMatchObject({ phone: '2222-2222', whatsapp: '8888-8888' });
  });
});
