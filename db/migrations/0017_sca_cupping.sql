-- ============================================================================
-- 0017_sca_cupping.sql — score coffee the way the industry already scores it
--
-- 0016 shipped a 1–5 star rating. That was invented here, and the coffee world
-- has had a standard for twenty years: the SCA cupping form, scored out of 100.
-- A shop, a green buyer, a competition and a bag of beans all speak it — "86.5"
-- means the same thing to all of them, and "4 stars" means nothing to any.
--
-- ── THE FORM (SCA cupping protocol) ─────────────────────────────────────────
-- Ten attributes, each scored 6.00–10.00 in quarter-point steps:
--
--   fragrance/aroma · flavour · aftertaste · acidity · body
--   uniformity · balance · clean cup · sweetness · overall
--
-- Summed they give 100. Taints and faults are then SUBTRACTED, and the result
-- is the cupping score. 80+ is "specialty" by definition; below 80 is
-- commodity. The scale starting at 6 is not an oversight — the form exists to
-- grade specialty coffee, and anything scoring under 6 on an attribute has a
-- defect, which is what the defect columns are for.
--
-- ── WHY `overall` IS THE ONLY REQUIRED ONE ──────────────────────────────────
-- Because most people are not cupping. Somebody drinking a bag at home can
-- honestly answer "how good is this, overall" on the same 6–10 anchors a judge
-- uses, and that answer is comparable with everyone else's. Demanding all ten
-- from a home brewer would produce ten invented numbers, which is worse data
-- than one real one.
--
-- So: `overall` always, the other nine optional, and `total_score` computes
-- only when a full form is present. The card shows a real cupping score where
-- one exists and the average overall where one does not, and says which.
--
-- ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
-- The 2023 Coffee Value Assessment (CVA) replaces this form with a descriptive
-- + affective pair. It is better and it is not yet what bags, shops and
-- competitions print. Adopting it now would mean nobody could compare a score
-- here with a score anywhere else, which is the entire point of using a
-- standard. Revisit when the trade has moved.
-- ============================================================================

-- Quarter-point steps, 6.00 to 10.00. Encoded once and reused ten times.
CREATE DOMAIN sca_attribute AS numeric(4, 2)
  CHECK (VALUE >= 6.00 AND VALUE <= 10.00 AND (VALUE * 4) = floor(VALUE * 4));

ALTER TABLE coffee_reviews
  -- The one everybody fills in.
  ADD COLUMN overall sca_attribute,

  -- The nine a cupper fills in.
  ADD COLUMN fragrance_aroma sca_attribute,
  ADD COLUMN flavour         sca_attribute,
  ADD COLUMN aftertaste      sca_attribute,
  ADD COLUMN acidity         sca_attribute,
  -- `body_score`, not `body`: 0016 already spent that name on the prose. The
  -- SCA attribute and somebody's paragraph are both "body" in English and can
  -- never be in Postgres, so the column that arrived second takes the suffix.
  ADD COLUMN body_score      sca_attribute,
  ADD COLUMN uniformity      sca_attribute,
  ADD COLUMN balance         sca_attribute,
  ADD COLUMN clean_cup       sca_attribute,
  ADD COLUMN sweetness       sca_attribute,

  -- Taints (2 points each) and faults (4 points each), by the protocol.
  ADD COLUMN taint_cups integer NOT NULL DEFAULT 0 CHECK (taint_cups BETWEEN 0 AND 5),
  ADD COLUMN fault_cups integer NOT NULL DEFAULT 0 CHECK (fault_cups BETWEEN 0 AND 5),

  -- Where it was scored. A cupping table and a kitchen are different claims
  -- about the same number, and a reader deserves to know which they are seeing.
  ADD COLUMN scored_at_table boolean NOT NULL DEFAULT false;

/*
 * The cupping score, computed rather than submitted.
 *
 * Generated because it is arithmetic on the other columns and a client that
 * disagreed with it would be wrong by definition. NULL until all ten attributes
 * are present — a partial form has no total, and inventing one by treating
 * missing attributes as zero would put every home note at the bottom of every
 * list.
 */
ALTER TABLE coffee_reviews
  ADD COLUMN total_score numeric(5, 2)
  GENERATED ALWAYS AS (
    CASE
      WHEN fragrance_aroma IS NOT NULL AND flavour IS NOT NULL AND aftertaste IS NOT NULL
       AND acidity IS NOT NULL AND body_score IS NOT NULL AND uniformity IS NOT NULL
       AND balance IS NOT NULL AND clean_cup IS NOT NULL AND sweetness IS NOT NULL
       AND overall IS NOT NULL
      THEN fragrance_aroma + flavour + aftertaste + acidity + body_score
         + uniformity + balance + clean_cup + sweetness + overall
         - (taint_cups * 2) - (fault_cups * 4)
      ELSE NULL
    END
  ) STORED;

-- ----------------------------------------------------------------------------
-- Carrying the stars across.
--
-- The five old ratings map onto the SCA anchors rather than onto a percentage:
-- 5 stars is "outstanding" (9), 3 is "good" (7), 1 is "below the specialty
-- line" (6, the floor). Approximate by construction — which is why the column
-- they came from is kept, not dropped, so the conversion stays auditable.
-- ----------------------------------------------------------------------------
UPDATE coffee_reviews
   SET overall = CASE rating
                   WHEN 5 THEN 9.00
                   WHEN 4 THEN 8.00
                   WHEN 3 THEN 7.00
                   WHEN 2 THEN 6.50
                   ELSE 6.00
                 END
 WHERE overall IS NULL;

ALTER TABLE coffee_reviews
  ALTER COLUMN overall SET NOT NULL,
  -- Was NOT NULL; now redundant and kept only as the provenance of the values
  -- above. Nothing writes it.
  ALTER COLUMN rating DROP NOT NULL;

COMMENT ON COLUMN coffee_reviews.rating IS
  'DEPRECATED (0017). The old 1-5 star score, kept so the conversion to `overall` stays auditable. Nothing writes it.';
COMMENT ON COLUMN coffee_reviews.overall IS
  'SCA "Overall" attribute, 6.00-10.00. The only score a home drinker is asked for, and the same one a judge fills in.';
COMMENT ON COLUMN coffee_reviews.total_score IS
  'SCA cupping score out of 100. NULL unless all ten attributes are present — a partial form has no total.';

CREATE INDEX idx_coffee_reviews_scored
  ON coffee_reviews (coffee_product_id, total_score DESC NULLS LAST)
  WHERE hidden_at IS NULL;
