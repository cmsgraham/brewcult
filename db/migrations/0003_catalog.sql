-- ============================================================================
-- 0003_catalog.sql
-- Purpose: catalog / entity-graph core per second_draft §21.2, modeling the
--   three-level coffee taxonomy (§6.1: CoffeeProduct ⊃ RoastBatch, provenance
--   in CoffeeLot), equipment entities, and the grinder-setting conversion
--   table (§6.4 — grind is always (grinder entity, setting, scale type),
--   never a bare number).
--
-- Data classification (EF §4.1) & retention (EF §4.2):
--   Every table in this file is P0 Public catalog data (cacheable, exportable).
--   No personal-data columns. Retention: indefinite (catalog is the product);
--   rows are soft-retired via status columns, not deleted, so reviews/brews
--   keep their referents (§6.1 seasonality rule).
--
-- Conventions: uuid PKs, created_at/updated_at + shared touch_updated_at()
--   trigger (defined in 0002) on every table.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- roasters
-- ----------------------------------------------------------------------------
CREATE TABLE roasters (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  slug       text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  location   text,                          -- city-level, human-entered (EF §4.1 minimization)
  verified   boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_roasters_touch
  BEFORE UPDATE ON roasters
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- origins — country/region pairs ("Ethiopia / Yirgacheffe")
-- ----------------------------------------------------------------------------
CREATE TABLE origins (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  country     text        NOT NULL,
  region      text,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (country, region)
);

CREATE TRIGGER trg_origins_touch
  BEFORE UPDATE ON origins
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- farms — farm / producer / washing station within an origin
-- ----------------------------------------------------------------------------
CREATE TABLE farms (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_id  uuid        NOT NULL REFERENCES origins(id) ON DELETE RESTRICT,
  name       text        NOT NULL,
  story      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (origin_id, name)
);

CREATE INDEX idx_farms_origin_id ON farms (origin_id);

CREATE TRIGGER trg_farms_touch
  BEFORE UPDATE ON farms
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- coffee_lots — the green coffee behind a product; provenance lives here
-- (§6.1). process is a controlled vocabulary + free-text detail column.
-- ----------------------------------------------------------------------------
CREATE TABLE coffee_lots (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_id      uuid        NOT NULL REFERENCES origins(id) ON DELETE RESTRICT,
  farm_id        uuid        REFERENCES farms(id) ON DELETE SET NULL,
  varietals      text[]      NOT NULL DEFAULT '{}',
  process        text        NOT NULL
                             CHECK (process IN ('washed','natural','honey','anaerobic','experimental')),
  process_detail text,                       -- free-text nuance ("72h anaerobic natural")
  altitude_masl  integer     CHECK (altitude_masl BETWEEN 0 AND 5000),
  harvest_period text,                       -- e.g. "2025/26 main crop", "Oct 2025 – Jan 2026"
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_coffee_lots_origin_id ON coffee_lots (origin_id);
CREATE INDEX idx_coffee_lots_farm_id   ON coffee_lots (farm_id);

CREATE TRIGGER trg_coffee_lots_touch
  BEFORE UPDATE ON coffee_lots
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- coffee_products — what a roaster sells; stable, SKU-like identity (§6.1).
-- Lots rotate seasonally: a new harvest is a NEW product row (or at minimum a
-- new lot link) so ratings never silently span harvests.
-- ----------------------------------------------------------------------------
CREATE TABLE coffee_products (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  roaster_id    uuid        NOT NULL REFERENCES roasters(id) ON DELETE RESTRICT,
  coffee_lot_id uuid        REFERENCES coffee_lots(id) ON DELETE SET NULL,
  name          text        NOT NULL,
  slug          text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  roast_level   text        NOT NULL
                            CHECK (roast_level IN ('light','medium-light','medium','medium-dark','dark')),
  intended_use  text        NOT NULL
                            CHECK (intended_use IN ('filter','espresso','omni')),
  tasting_notes text[]      NOT NULL DEFAULT '{}',
  status        text        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','seasonal','discontinued')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_coffee_products_roaster_id ON coffee_products (roaster_id);
CREATE INDEX idx_coffee_products_lot_id     ON coffee_products (coffee_lot_id);
CREATE INDEX idx_coffee_products_status     ON coffee_products (status);

CREATE TRIGGER trg_coffee_products_touch
  BEFORE UPDATE ON coffee_products
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- roast_batches — a specific roast date of a product; freshness lives here
-- (§6.1/§6.2). Reviews and brew sessions reference the batch when known.
-- ----------------------------------------------------------------------------
CREATE TABLE roast_batches (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  coffee_product_id uuid        NOT NULL REFERENCES coffee_products(id) ON DELETE CASCADE,
  roast_date        date        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_roast_batches_product_date ON roast_batches (coffee_product_id, roast_date);

CREATE TRIGGER trg_roast_batches_touch
  BEFORE UPDATE ON roast_batches
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- equipment_brands / equipment_models — §21.2. grind_scale_type encodes the
-- scale semantics from §6.4 (stepped / stepless / rotational, e.g. "2.6 on a
-- Comandante" = 2 rotations + 6 clicks) and is only meaningful — and only
-- allowed — for grinders.
-- ----------------------------------------------------------------------------
CREATE TABLE equipment_brands (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_equipment_brands_touch
  BEFORE UPDATE ON equipment_brands
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE equipment_models (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id         uuid        NOT NULL REFERENCES equipment_brands(id) ON DELETE RESTRICT,
  category         text        NOT NULL
                               CHECK (category IN ('brewer','grinder','kettle','scale','machine','accessory')),
  name             text        NOT NULL,
  slug             text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  specs            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  grind_scale_type text        CHECK (grind_scale_type IN ('stepped','stepless','rotational')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- grind_scale_type: required for grinders, forbidden for everything else
  CONSTRAINT equipment_models_grind_scale_only_grinders CHECK (
    (category = 'grinder' AND grind_scale_type IS NOT NULL)
    OR (category <> 'grinder' AND grind_scale_type IS NULL)
  )
);

CREATE INDEX idx_equipment_models_brand_id ON equipment_models (brand_id);
CREATE INDEX idx_equipment_models_category ON equipment_models (category);

CREATE TRIGGER trg_equipment_models_touch
  BEFORE UPDATE ON equipment_models
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- grind_conversions — crowd-sourced (grinder A, setting) → (grinder B, setting)
-- pairs (§6.4). Seeded rows come from published community charts (low
-- confidence); user_confirmed rows come from successful forked brews. The
-- 4-tuple is unique; app upserts bump confidence rather than duplicate.
-- ----------------------------------------------------------------------------
CREATE TABLE grind_conversions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_model_id uuid        NOT NULL REFERENCES equipment_models(id) ON DELETE CASCADE,
  from_setting  text        NOT NULL,
  to_model_id   uuid        NOT NULL REFERENCES equipment_models(id) ON DELETE CASCADE,
  to_setting    text        NOT NULL,
  source        text        NOT NULL CHECK (source IN ('user_confirmed','seeded')),
  confidence    real        NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grind_conversions_distinct_models CHECK (from_model_id <> to_model_id),
  UNIQUE (from_model_id, from_setting, to_model_id, to_setting)
);

CREATE INDEX idx_grind_conversions_from ON grind_conversions (from_model_id);
CREATE INDEX idx_grind_conversions_to   ON grind_conversions (to_model_id);

CREATE TRIGGER trg_grind_conversions_touch
  BEFORE UPDATE ON grind_conversions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
