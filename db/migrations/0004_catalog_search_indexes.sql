-- 0004_catalog_search_indexes.sql
--
-- Purpose: performance + schema-honesty additions for the catalog read paths
-- (CAT-06 autocomplete, CAT-07 search, keyset pagination), requested by the
-- catalog module after its query shapes settled.
--
-- Data classification (EF §4.1): P0 Public throughout — this migration touches
-- only catalog tables (coffee_products, roasters, equipment_*, origins,
-- grind_conversions), which hold published product/reference data. No personal
-- data, so no retention rule applies (EF §4.2).
--
-- Notes:
--   * pg_trgm ships with the pgvector/pgvector:pg16 image used in compose.
--     PGlite-based unit tests apply 0001..0003 only and are unaffected.
--   * The generated `search_document` columns are the durable form of the
--     tsvector expressions currently computed on the fly in
--     modules/catalog/repository.ts (COFFEE_TSVECTOR / ROASTER_TSVECTOR).
--     Keep the two in sync; the repository should switch its FTS queries to
--     read these columns so the GIN indexes below are actually used.

-- 1. Trigram support for autocomplete (substring matching cannot use a btree).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_coffee_products_name_trgm
  ON coffee_products USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_roasters_name_trgm
  ON roasters USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_equipment_models_name_trgm
  ON equipment_models USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_equipment_brands_name_trgm
  ON equipment_brands USING gin (lower(name) gin_trgm_ops);

-- 2. Full-text search documents. Generated columns keep the vector in sync with
--    the row automatically; cross-table terms (roaster/origin names) stay in the
--    repository's join-time query until a materialised view is justified.
-- array_to_string() is only STABLE (an element type's output function may be),
-- so Postgres rejects it in a generated column. For text[] the output is
-- genuinely immutable, so a thin IMMUTABLE wrapper is safe and is the standard
-- workaround. Likewise to_tsvector needs its config passed as a regconfig
-- literal — the text form resolves the config at runtime and is only STABLE.
CREATE OR REPLACE FUNCTION brewcult_text_array_to_string(arr text[])
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT array_to_string(arr, ' ') $$;

ALTER TABLE coffee_products
  ADD COLUMN IF NOT EXISTS search_document tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'english'::regconfig,
      coalesce(name, '') || ' ' ||
      coalesce(brewcult_text_array_to_string(tasting_notes), '') || ' ' ||
      coalesce(roast_level, '') || ' ' ||
      coalesce(intended_use, '')
    )
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_coffee_products_fts
  ON coffee_products USING gin (search_document);

ALTER TABLE roasters
  ADD COLUMN IF NOT EXISTS search_document tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english'::regconfig, coalesce(name, '') || ' ' || coalesce(location, ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_roasters_fts
  ON roasters USING gin (search_document);

ALTER TABLE equipment_models
  ADD COLUMN IF NOT EXISTS search_document tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english'::regconfig, coalesce(name, '') || ' ' || coalesce(category, ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_equipment_models_fts
  ON equipment_models USING gin (search_document);

-- 3. Keyset pagination ordering keys, matching the (created_at DESC, id DESC)
--    cursor the catalog module encodes.
CREATE INDEX IF NOT EXISTS idx_coffee_products_keyset
  ON coffee_products (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_roasters_keyset
  ON roasters (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_equipment_models_keyset
  ON equipment_models (created_at DESC, id DESC);

-- 4. Country filter on GET /v1/coffees?origin=<country>.
CREATE INDEX IF NOT EXISTS idx_origins_country_lower
  ON origins (lower(country));

-- 5. §6.4 honesty: store how many confirmed observations back a conversion so
--    "based on 37 community data points" is a recorded fact rather than a row
--    count inferred at query time. Seeded rows keep the default of 1.
ALTER TABLE grind_conversions
  ADD COLUMN IF NOT EXISTS data_points integer NOT NULL DEFAULT 1;
ALTER TABLE grind_conversions
  DROP CONSTRAINT IF EXISTS grind_conversions_data_points_positive;
ALTER TABLE grind_conversions
  ADD CONSTRAINT grind_conversions_data_points_positive CHECK (data_points >= 1);
