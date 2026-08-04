-- ============================================================================
-- 0001_extensions.sql
-- Purpose: PostgreSQL extensions required by the BrewCult schema.
--   * vector   (pgvector) — embedding columns arrive with the AI/search work
--                (second_draft §16); installed day one so the image contract
--                (pgvector/pgvector:pg16, DG §3) is exercised from migration 1.
--   * pgcrypto — gen_random_uuid() for all uuid primary keys.
--   * citext   — case-insensitive handles and emails (identity tables, 0002).
--
-- Data classification (EF §4.1): no tables created here — nothing to classify.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
