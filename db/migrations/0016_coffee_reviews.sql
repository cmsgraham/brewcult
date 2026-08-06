-- ============================================================================
-- 0016_coffee_reviews.sql — a coffee is something people argue about
--
-- Deliberately the SAME SHAPE as `recipe_reviews` (0006): a rating from one to
-- five, an optional body, one per person per coffee. Two review systems with
-- different rules would mean two moderation stories, two rate limits and two
-- sets of copy explaining why editing works differently over here.
--
-- ── ONE PER PERSON, EDITABLE ────────────────────────────────────────────────
-- The UNIQUE below is the whole social design in one constraint. A thread where
-- one person can post fifteen times is a thread the loudest person wins; a
-- rating that cannot be changed is a rating nobody dares leave. So: one note
-- per coffee, edited in place, and `updated_at` shows when it changed.
--
-- ── WHY VOTES ARE ON NOTES, NOT ON COFFEES ──────────────────────────────────
-- "Was this useful?" is answerable. "Is this coffee good?" is what the rating
-- already asks, and a second up/down on the coffee itself would compete with it
-- — two numbers that disagree, and no way to say which one the card should
-- show. So the vote is `helpful` on somebody's note, which is the thing that
-- decides what gets read first.
-- ============================================================================

CREATE TABLE coffee_reviews (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  coffee_product_id uuid        NOT NULL REFERENCES coffee_products (id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  rating            smallint    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body              text        CHECK (body IS NULL OR char_length(body) <= 4000),

  -- How they made it, in their words. Optional, and never parsed — it is here
  -- because "tasted thin" means something different at 1:18 than at 1:14, and a
  -- note without that context starts arguments it cannot settle.
  brew_method       text        CHECK (brew_method IS NULL OR char_length(brew_method) <= 60),

  -- Moderation, matching the pattern reports already use: hidden rather than
  -- deleted, so a decision can be reviewed and the author can be told.
  hidden_at         timestamptz,
  hidden_by         uuid        REFERENCES users (id) ON DELETE SET NULL,
  hidden_reason     text        CHECK (hidden_reason IS NULL OR char_length(hidden_reason) <= 500),

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- The social design, enforced rather than requested.
  UNIQUE (coffee_product_id, user_id)
);

CREATE INDEX idx_coffee_reviews_coffee
  ON coffee_reviews (coffee_product_id, created_at DESC)
  WHERE hidden_at IS NULL;

CREATE INDEX idx_coffee_reviews_user ON coffee_reviews (user_id, created_at DESC);

CREATE TRIGGER trg_coffee_reviews_touch
  BEFORE UPDATE ON coffee_reviews
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- "That was useful." One per person per note, and never your own.
--
-- The self-vote rule is in the database rather than only in a handler because
-- it is a rule about the data, not about a request: no sequence of API calls,
-- migrations or console pokes should be able to produce a row where somebody
-- upvoted themselves.
-- ----------------------------------------------------------------------------
CREATE TABLE coffee_review_votes (
  review_id  uuid        NOT NULL REFERENCES coffee_reviews (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (review_id, user_id)
);

CREATE INDEX idx_coffee_review_votes_review ON coffee_review_votes (review_id);

-- Enforced with a trigger because the author is on the OTHER table: a CHECK
-- cannot see it, and a foreign key cannot express "different from".
CREATE OR REPLACE FUNCTION refuse_self_vote() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM coffee_reviews r
     WHERE r.id = NEW.review_id AND r.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'A note cannot be voted useful by the person who wrote it';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_coffee_review_votes_no_self
  BEFORE INSERT ON coffee_review_votes
  FOR EACH ROW EXECUTE FUNCTION refuse_self_vote();

COMMENT ON TABLE coffee_reviews IS
  'One note per person per coffee, edited in place. Hidden rather than deleted when moderated. See 0016.';
COMMENT ON TABLE coffee_review_votes IS
  '"That was useful", on a NOTE rather than on the coffee — the rating already answers whether the coffee is good. See 0016.';
