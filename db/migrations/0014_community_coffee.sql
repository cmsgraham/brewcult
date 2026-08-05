-- ============================================================================
-- 0014_community_coffee.sql — photograph a bag, get a coffee
--
-- The same shape as 0011/0013 for equipment, with one difference that runs
-- through everything below: the assistant is not RECALLING a coffee, it is
-- READING one. A bag prints its own facts — roaster, origin, process, roast
-- date, tasting notes — so a photo of the label is a better source than the
-- model's memory could ever be for a lot roasted last week.
--
-- ── WHY A COFFEE IS NOT A GRINDER ───────────────────────────────────────────
-- A Niche Zero is the same object for years. A coffee is a lot: relevant for
-- weeks, gone by the season. Two consequences are baked into the tables here:
--
--   * `roast_batches` already exists (0003) and matters here. Freshness is not
--     a property of the product, it is a property of the bag in your cupboard,
--     which is why the shelf below records a roast date and the catalogue row
--     does not.
--   * `status` on coffee_products means what it says. A community coffee is
--     'active' when it is added and somebody will eventually mark it
--     'discontinued'; the row is not wrong afterwards, just historical.
--
-- ── ROASTERS ARE BUSINESSES ─────────────────────────────────────────────────
-- Every coffee needs one (`roaster_id NOT NULL`), so member submissions mint
-- roaster rows. By product decision those are created UNVERIFIED: `verified`
-- already exists on the table and now carries its full weight — it is the
-- difference between "somebody typed this name" and "we know this business".
-- Nothing here marks a roaster verified, and no code path should.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Provenance, matching 0013's vocabulary exactly so both catalogues answer the
-- same question the same way.
-- ----------------------------------------------------------------------------
ALTER TABLE roasters
  ADD COLUMN source text NOT NULL DEFAULT 'editorial'
    CHECK (source IN ('editorial', 'community')),
  ADD COLUMN submitted_by uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewed_by uuid REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE coffee_products
  ADD COLUMN source text NOT NULL DEFAULT 'editorial'
    CHECK (source IN ('editorial', 'community')),
  ADD COLUMN submitted_by uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewed_by uuid REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX idx_coffee_products_unreviewed
  ON coffee_products (created_at DESC)
  WHERE source = 'community' AND reviewed_at IS NULL;

CREATE INDEX idx_roasters_unreviewed
  ON roasters (created_at DESC)
  WHERE source = 'community' AND reviewed_at IS NULL;

COMMENT ON COLUMN roasters.verified IS
  'We have confirmed this is the business it claims to be. Community submissions are NEVER verified — see 0014.';

-- ----------------------------------------------------------------------------
-- "What is in my cupboard." The private half, and the one that matters most.
--
-- A coffee you are drinking has to be loggable IMMEDIATELY — the whole point of
-- the shelf is that brew logging has something to point at. So this never waits
-- for anything: if the assistant published a catalogue row it points there, and
-- if it did not, the name you photographed is stored right here and works
-- exactly the same for your own brews.
-- ----------------------------------------------------------------------------
CREATE TABLE user_coffees (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- Set when the coffee is in the shared catalogue.
  coffee_product_id uuid        REFERENCES coffee_products (id) ON DELETE SET NULL,

  -- Set when it is not. Same either-or shape as user_equipment in 0011.
  custom_roaster    text        CHECK (custom_roaster IS NULL OR char_length(custom_roaster) BETWEEN 1 AND 120),
  custom_name       text        CHECK (custom_name IS NULL OR char_length(custom_name) BETWEEN 1 AND 160),

  -- Freshness lives on the BAG, not on the product. A roast date is the single
  -- most useful thing a photo gives us that a catalogue row cannot.
  roast_date        date,
  -- Your own words about this bag. Never public, never fed to the catalogue.
  notes             text        CHECK (notes IS NULL OR char_length(notes) <= 2000),
  finished_at       timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_coffees_product_or_custom CHECK (
    (coffee_product_id IS NOT NULL AND custom_roaster IS NULL AND custom_name IS NULL)
    OR (coffee_product_id IS NULL AND custom_name IS NOT NULL)
  ),
  -- A roast date in the future is a typo, and a 1970 date is a broken parse.
  CONSTRAINT user_coffees_roast_date_sane CHECK (
    roast_date IS NULL OR (roast_date > date '2000-01-01' AND roast_date <= current_date + 1)
  )
);

CREATE INDEX idx_user_coffees_user ON user_coffees (user_id, created_at DESC);

-- The same bag twice is a double-click. Two BAGS of the same coffee, though,
-- are a real thing a person has — so this is scoped to what is still open.
CREATE UNIQUE INDEX uq_user_coffees_open_product
  ON user_coffees (user_id, coffee_product_id)
  WHERE coffee_product_id IS NOT NULL AND finished_at IS NULL;

CREATE UNIQUE INDEX uq_user_coffees_open_custom
  ON user_coffees (user_id, lower(coalesce(custom_roaster, '')), lower(custom_name))
  WHERE coffee_product_id IS NULL AND finished_at IS NULL;

CREATE TRIGGER trg_user_coffees_touch
  BEFORE UPDATE ON user_coffees
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- The submission itself, mirroring equipment_requests (0011 + 0013).
-- ----------------------------------------------------------------------------
CREATE TABLE coffee_requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id   uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- Whatever they typed. May be empty when the photo IS the submission, which
  -- for a coffee bag is the common case — hence the looser check than 0011's.
  submitted_text text        NOT NULL DEFAULT ''
                             CHECK (char_length(submitted_text) <= 4000),
  image_media_id uuid        REFERENCES media (id) ON DELETE SET NULL,

  ai_draft       jsonb,
  ai_error       text,

  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','approved','rejected')),
  decision_note  text        CHECK (decision_note IS NULL OR char_length(decision_note) <= 1000),
  decided_by     uuid        REFERENCES users (id) ON DELETE SET NULL,
  decided_by_assistant boolean NOT NULL DEFAULT false,
  decided_at     timestamptz,

  coffee_product_id uuid     REFERENCES coffee_products (id) ON DELETE SET NULL,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- Text or a photo. A submission with neither is nothing at all.
  CONSTRAINT coffee_requests_has_content CHECK (
    char_length(btrim(submitted_text)) > 0 OR image_media_id IS NOT NULL
  ),

  CONSTRAINT coffee_requests_decision_complete CHECK (
    (status = 'pending'
       AND decided_by IS NULL AND decided_at IS NULL AND decided_by_assistant = false)
    OR
    (status <> 'pending'
       AND decided_at IS NOT NULL
       AND (decided_by IS NOT NULL OR decided_by_assistant = true))
  )
);

CREATE INDEX idx_coffee_requests_pending
  ON coffee_requests (created_at)
  WHERE status = 'pending';

CREATE INDEX idx_coffee_requests_requester
  ON coffee_requests (requester_id, created_at DESC);

CREATE TRIGGER trg_coffee_requests_touch
  BEFORE UPDATE ON coffee_requests
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- One batch per roast date per coffee.
--
-- 0003 created roast_batches with no uniqueness, which was fine while only
-- editors wrote them. It is not fine now: every person who photographs the same
-- bag reports the same roast date, and without this the table grows a row per
-- photograph. `ON CONFLICT DO NOTHING` in the writer is only meaningful with a
-- constraint to conflict WITH — it silently did nothing before this existed.
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX uq_roast_batches_product_date
  ON roast_batches (coffee_product_id, roast_date);

COMMENT ON TABLE user_coffees IS
  'Bags on somebody''s shelf. Private, immediate, and independent of whether the coffee ever reaches the shared catalogue. See 0014.';
