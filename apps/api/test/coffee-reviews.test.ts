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
      rating: 4,
      body: 'Peachy, best at 1:16.',
      brewMethod: 'V60',
    });
    expect(review).toMatchObject({
      rating: 4,
      body: 'Peachy, best at 1:16.',
      brew_method: 'V60',
      is_mine: true,
      helpful_count: 0,
    });
  });

  it('EDITS rather than stacking a second note', async () => {
    await upsertCoffeeReview(db, { coffeeProductId: coffeeId, userId: alice, rating: 2 });
    await upsertCoffeeReview(db, {
      coffeeProductId: coffeeId,
      userId: alice,
      rating: 5,
      body: 'Ground finer, completely different coffee.',
    });

    const items = await listCoffeeReviews(db, coffeeId, alice);
    // A thread where one person can post fifteen times is a thread the loudest
    // person wins.
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ rating: 5 });
  });

  it('refuses a rating outside one to five', async () => {
    for (const rating of [0, 6, 3.5, Number.NaN]) {
      await expect(
        upsertCoffeeReview(db, { coffeeProductId: coffeeId, userId: alice, rating }),
      ).rejects.toThrow();
    }
  });

  it('lets you take your own note back', async () => {
    const review = await upsertCoffeeReview(db, {
      coffeeProductId: coffeeId,
      userId: alice,
      rating: 3,
    });
    expect(await deleteCoffeeReview(db, review.id, bob)).toBe(false); // not bob's
    expect(await deleteCoffeeReview(db, review.id, alice)).toBe(true);
    expect(await listCoffeeReviews(db, coffeeId, alice)).toHaveLength(0);
  });
});

describe('the number on the card', () => {
  it('averages what people said', async () => {
    await upsertCoffeeReview(db, { coffeeProductId: coffeeId, userId: alice, rating: 5 });
    await upsertCoffeeReview(db, { coffeeProductId: coffeeId, userId: bob, rating: 4 });
    await upsertCoffeeReview(db, { coffeeProductId: coffeeId, userId: carol, rating: 3 });

    expect(await ratingSummary(db, coffeeId)).toEqual({ average: 4, count: 3 });
  });

  it('says nothing rather than zero when nobody has rated it', async () => {
    // A coffee showing "0 out of 5" reads as "everybody hated this", not as
    // "nobody has tried it".
    expect(await ratingSummary(db, coffeeId)).toEqual({ average: null, count: 0 });
  });

  it('excludes a hidden note from the average as well as the list', async () => {
    const bad = await upsertCoffeeReview(db, {
      coffeeProductId: coffeeId,
      userId: alice,
      rating: 1,
      body: 'something abusive',
    });
    await upsertCoffeeReview(db, { coffeeProductId: coffeeId, userId: bob, rating: 5 });

    expect(await hideCoffeeReview(db, bad.id, carol, 'abuse')).toBe(true);
    expect(await ratingSummary(db, coffeeId)).toEqual({ average: 5, count: 1 });
    expect(await listCoffeeReviews(db, coffeeId, alice)).toHaveLength(1);
  });
});

describe('marking a note useful', () => {
  it('toggles on and off', async () => {
    const review = await upsertCoffeeReview(db, {
      coffeeProductId: coffeeId,
      userId: alice,
      rating: 4,
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
      rating: 4,
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
      rating: 4,
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
      rating: 5,
    });
    await toggleHelpful(db, popular.id, carol);
    await upsertCoffeeReview(db, { coffeeProductId: coffeeId, userId: alice, rating: 3 });

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
      rating: 2,
    });
    const useful = await upsertCoffeeReview(db, {
      coffeeProductId: coffeeId,
      userId: bob,
      rating: 5,
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
});
