-- ============================================================================
-- 0006_brewing.sql — brewing module (Wave 3, Lane H)
--
-- Purpose: recipes, recipe reviews, brew sessions and the grind-conversion
--   capture linkage, per second_draft §6.3 (two recipe schemas), §6.4 (grind is
--   always (grinder entity, setting, scale type) + a mandatory coarse
--   category), §6.6 (fork lineage with a stored diff, permanent attribution)
--   and §6.7 (structured taste → extraction diagnosis). Backlog REC-01..REC-07,
--   BREW-01/05/08, GC-02.
--
-- Also lands the minimal transactional outbox (`domain_events`) that BREW-08
--   needs. F-12 ("outbox + event bus skeleton") had not shipped when this lane
--   ran and there was no other outbox in the repo, so this file defines the
--   table rather than inventing a second mechanism. F-12 should adopt it (add
--   the relay + envelope versioning) instead of creating a parallel one.
--
-- Data classification (EF §4.1) & retention (EF §4.2) — per table:
--   recipes                      P0 Public when visibility='public'/'unlisted';
--                                P1 while 'private'. author_id is the only
--                                personal linkage. Retention: account life.
--                                Public recipes with forks are ANONYMIZED on
--                                account deletion, never destroyed (EF §4.3) —
--                                hence author_id ON DELETE RESTRICT: the
--                                deletion job must anonymize the users row, and
--                                the database refuses to silently orphan
--                                attribution that other people's forks cite.
--   recipe_reviews               P1 pseudonymous activity. Deleted with account.
--   brew_sessions                P1 pseudonymous activity (EF §4.1 "brew
--                                sessions, taste features"): per-user access
--                                only, feeds aggregates. Retention: account
--                                life; hard-deleted within 30 days of account
--                                deletion (ON DELETE CASCADE from users), and
--                                soft-deleted rows (deleted_at) are purged by
--                                the retention job 30 days after deletion so the
--                                sync tombstone has time to reach every client.
--   brew_grind_observations      P1. Cascades with the session it came from; the
--                                aggregate it feeds (grind_conversions) keeps no
--                                user linkage, which is the point of the split.
--   domain_events                P1 (payloads carry ids and decisions only —
--                                never taste prose, never personal data).
--                                Retention: 14 months (EF §4.2 product
--                                analytics raw), purged by a scheduled job.
--
-- Conventions match 0002/0003: uuid PKs, created_at/updated_at + the shared
--   touch_updated_at() trigger on every mutable table. Two deliberate
--   deviations, both documented inline: `recipes.id` and `brew_sessions.id` have
--   NO default — they are client-minted UUIDv7 (EF §2.2), and the API supplies
--   one on every server-side create; and `domain_events` is append-only
--   (created_at only, like login_attempts).
--
-- IMMUTABILITY NOTE (see 0004): expressions in generated columns must be
--   IMMUTABLE. `jsonb ->> text` and CASE are immutable, so `diagnosis` below is
--   legal; anything needing to_tsvector/array_to_string would have to use the
--   regconfig literal / brewcult_text_array_to_string wrapper from 0004.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- recipes — REC-01..REC-05. `params` is versioned JSONB validated at the API
-- boundary against the FilterParams | EspressoParams union in
-- packages/shared-types/src/brewing.ts (EF §1.3); `params_schema_version`
-- records which shape was written so readers stay tolerant of older rows.
--
-- The CHECK that params->>'method' equals the `method` column is the database's
-- half of the discriminated union: even if a future caller bypassed the JSON
-- Schema, an espresso body can never be stored on a filter recipe.
-- ----------------------------------------------------------------------------
CREATE TABLE recipes (
  id                    uuid        PRIMARY KEY,   -- client-minted UUIDv7 (EF §2.2); no default by design
  author_id             uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title                 text        NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  -- Target coffee, or NULL for a style-level recipe ("any light washed", §6.3).
  coffee_product_id     uuid        REFERENCES coffee_products(id) ON DELETE SET NULL,
  coffee_style          text,
  method                text        NOT NULL CHECK (method IN ('filter','immersion','espresso')),
  brewer_model_id       uuid        REFERENCES equipment_models(id) ON DELETE SET NULL,
  -- GrindSetting: {equipment_model_id, setting, scale_type, category}. Category
  -- is mandatory (§6.4 point 2) — it is the only value that survives a change of
  -- grinder, so it is enforced here and not only in the API schema.
  grind                 jsonb       NOT NULL,
  params                jsonb       NOT NULL,
  params_schema_version integer     NOT NULL DEFAULT 1 CHECK (params_schema_version >= 1),
  -- Fork lineage (§6.6). RESTRICT: attribution is permanent, so a parent that
  -- has forks cannot be deleted out from under them.
  parent_recipe_id      uuid        REFERENCES recipes(id) ON DELETE RESTRICT,
  -- Offline sync conflict copy (EF §2.2 / REC-07). Kept SEPARATE from
  -- parent_recipe_id: a conflicted copy is a sync artefact, not a fork, and
  -- mixing the two would corrupt the "what people change" fork analytics (§6.6).
  conflict_of_recipe_id uuid        REFERENCES recipes(id) ON DELETE SET NULL,
  changed_fields        text[]      NOT NULL DEFAULT '{}',
  version               integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  visibility            text        NOT NULL DEFAULT 'private'
                                    CHECK (visibility IN ('private','unlisted','public')),
  is_official           boolean     NOT NULL DEFAULT false,
  -- Soft delete: a hard DELETE would strand fork children and would give the
  -- offline clients nothing to sync. `deleted_at` IS the sync tombstone.
  deleted_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT recipes_params_method_matches CHECK (params->>'method' = method),
  CONSTRAINT recipes_grind_category_valid CHECK (
    grind->>'category' IN ('extra_fine','fine','medium_fine','medium','medium_coarse','coarse')
  ),
  -- changed_fields is defined relative to a parent (fork) or to the row a
  -- conflict copy diverged from. A root recipe has nothing to diff against.
  CONSTRAINT recipes_changed_fields_need_origin CHECK (
    parent_recipe_id IS NOT NULL
    OR conflict_of_recipe_id IS NOT NULL
    OR cardinality(changed_fields) = 0
  ),
  CONSTRAINT recipes_no_self_parent CHECK (id <> parent_recipe_id),
  CONSTRAINT recipes_no_self_conflict CHECK (id <> conflict_of_recipe_id)
);

-- Author's own library, and the policy layer's most common lookup.
CREATE INDEX idx_recipes_author_visibility ON recipes (author_id, visibility, created_at DESC);
-- Public browse / SEO pages (REC-06), keyset-ordered like the catalog lists.
CREATE INDEX idx_recipes_public_keyset ON recipes (created_at DESC, id DESC)
  WHERE visibility = 'public' AND deleted_at IS NULL;
-- Fork lineage walks: "show me the forks of this recipe" (§6.6 attribution UI).
CREATE INDEX idx_recipes_parent ON recipes (parent_recipe_id) WHERE parent_recipe_id IS NOT NULL;
CREATE INDEX idx_recipes_conflict_of ON recipes (conflict_of_recipe_id)
  WHERE conflict_of_recipe_id IS NOT NULL;
-- Prefill fallback: an official/community recipe for this coffee + method.
CREATE INDEX idx_recipes_coffee_method ON recipes (coffee_product_id, method, is_official DESC)
  WHERE visibility = 'public' AND deleted_at IS NULL;
-- GET /v1/sync/changes?types=recipe — the caller's own rows since a cursor.
CREATE INDEX idx_recipes_sync ON recipes (author_id, updated_at, id);
-- Grinder the recipe was written on, for the conversion lookup (§6.4).
CREATE INDEX idx_recipes_grinder ON recipes ((grind->>'equipment_model_id'));

CREATE TRIGGER trg_recipes_touch
  BEFORE UPDATE ON recipes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- recipe_reviews — one review per user per recipe. Body is optional: a rating
-- alone is a valid contribution (§6.7 "never require prose").
-- ----------------------------------------------------------------------------
CREATE TABLE recipe_reviews (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id  uuid        NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     smallint    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body       text        CHECK (body IS NULL OR length(body) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, user_id)
);

CREATE INDEX idx_recipe_reviews_recipe ON recipe_reviews (recipe_id, created_at DESC);
CREATE INDEX idx_recipe_reviews_user   ON recipe_reviews (user_id, created_at DESC);

CREATE TRIGGER trg_recipe_reviews_touch
  BEFORE UPDATE ON recipe_reviews
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- brew_sessions — BREW-01. The id is CLIENT-generated (UUIDv7, EF §2.2) so a
-- retried offline sync can never double-log: PUT /v1/brews/{id} is an idempotent
-- upsert keyed on this column.
--
-- `body_hash` is what makes "re-PUT of the same body = noop" cheap and exact:
-- the API hashes the canonicalised payload and compares. Without it a noop would
-- still fire the touch trigger and bump updated_at, which would republish the
-- row to every other device on the next sync pull for no reason.
--
-- `diagnosis` is a STORED generated column, not an application field: the
-- taste→extraction mapping (§6.7) is server-authoritative, so advice, stored
-- analysis and any future client can never disagree about it. The API exports
-- the same mapping in TypeScript and the test suite asserts the two agree.
-- ----------------------------------------------------------------------------
CREATE TABLE brew_sessions (
  id                    uuid        PRIMARY KEY,   -- client-minted UUIDv7; no default by design
  user_id               uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id             uuid        REFERENCES recipes(id) ON DELETE SET NULL,
  coffee_product_id     uuid        REFERENCES coffee_products(id) ON DELETE SET NULL,
  roast_batch_id        uuid        REFERENCES roast_batches(id) ON DELETE SET NULL,
  brewer_model_id       uuid        REFERENCES equipment_models(id) ON DELETE SET NULL,
  grinder_model_id      uuid        REFERENCES equipment_models(id) ON DELETE SET NULL,
  grind                 jsonb       NOT NULL,
  params                jsonb       NOT NULL,
  params_schema_version integer     NOT NULL DEFAULT 1 CHECK (params_schema_version >= 1),
  water                 jsonb,                     -- WaterProfile (§6.5, presets only in v1)
  taste                 jsonb,                     -- TasteResult (§6.7)
  measurements          jsonb,                     -- TDS / extraction yield, never required
  rating                smallint    CHECK (rating BETWEEN 1 AND 5),
  changed_fields        text[]      NOT NULL DEFAULT '{}',
  source                text        NOT NULL CHECK (source IN ('repeat','tweak','new','import')),
  photo_media_id        uuid,                      -- FK lands with BREW-06 (media table)
  brewed_at             timestamptz NOT NULL DEFAULT now(),
  body_hash             text        NOT NULL,
  deleted_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  diagnosis text GENERATED ALWAYS AS (
    CASE taste->>'verdict'
      WHEN 'bitter' THEN 'over_extracted'
      WHEN 'sour'   THEN 'under_extracted'
      WHEN 'weak'   THEN 'under_extracted'
      WHEN 'good'   THEN 'balanced'
      ELSE 'unclear'
    END
  ) STORED,

  CONSTRAINT brew_sessions_params_method_valid CHECK (
    params->>'method' IN ('filter','immersion','espresso')
  ),
  CONSTRAINT brew_sessions_grind_category_valid CHECK (
    grind->>'category' IN ('extra_fine','fine','medium_fine','medium','medium_coarse','coarse')
  ),
  CONSTRAINT brew_sessions_taste_verdict_valid CHECK (
    taste IS NULL OR taste->>'verdict' IN ('bitter','sour','weak','good')
  )
);

-- The history screen and the prefill fast path (BREW-07, §5 of the logger UX).
CREATE INDEX idx_brew_sessions_user_brewed ON brew_sessions (user_id, brewed_at DESC, id DESC)
  WHERE deleted_at IS NULL;
-- GET /v1/brews/prefill?coffee_product_id= — "my last brew of THIS bag", the
-- single most latency-sensitive query in the product (15s bar).
CREATE INDEX idx_brew_sessions_user_coffee ON brew_sessions (user_id, coffee_product_id, brewed_at DESC)
  WHERE deleted_at IS NULL;
-- Aggregates across users for one coffee (community stats, taste model input).
CREATE INDEX idx_brew_sessions_coffee ON brew_sessions (coffee_product_id, brewed_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_brew_sessions_recipe ON brew_sessions (recipe_id) WHERE recipe_id IS NOT NULL;
-- GET /v1/sync/changes?types=brew_session.
CREATE INDEX idx_brew_sessions_sync ON brew_sessions (user_id, updated_at, id);

CREATE TRIGGER trg_brew_sessions_touch
  BEFORE UPDATE ON brew_sessions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- brew_grind_observations — GC-02 / risk #9 linkage.
--
-- The rule the schema enforces: a (grinder A, setting) → (grinder B, setting)
-- pair only ever enters catalog's `grind_conversions` together with a row here,
-- and a row here requires a real brew_session that the user rated good. The
-- UNIQUE constraint on brew_session_id is the anti-double-count guard: a session
-- edited and re-synced five times still contributes exactly one data point.
--
-- Unconfirmed guesses (a fork the user never brewed, or brewed and rated badly)
-- produce NO row here and therefore never touch the dataset.
-- ----------------------------------------------------------------------------
CREATE TABLE brew_grind_observations (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One observation per session, ever.
  brew_session_id     uuid        NOT NULL UNIQUE REFERENCES brew_sessions(id) ON DELETE CASCADE,
  recipe_id           uuid        REFERENCES recipes(id) ON DELETE SET NULL,
  parent_recipe_id    uuid        REFERENCES recipes(id) ON DELETE SET NULL,
  grind_conversion_id uuid        NOT NULL REFERENCES grind_conversions(id) ON DELETE CASCADE,
  from_model_id       uuid        NOT NULL REFERENCES equipment_models(id) ON DELETE CASCADE,
  from_setting        text        NOT NULL,
  to_model_id         uuid        NOT NULL REFERENCES equipment_models(id) ON DELETE CASCADE,
  to_setting          text        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brew_grind_observations_distinct_models CHECK (from_model_id <> to_model_id)
);

CREATE INDEX idx_brew_grind_obs_conversion ON brew_grind_observations (grind_conversion_id);
CREATE INDEX idx_brew_grind_obs_pair       ON brew_grind_observations (from_model_id, to_model_id);

-- ----------------------------------------------------------------------------
-- domain_events — minimal transactional outbox (BREW-08; F-12 should adopt).
--
-- Events are inserted in the SAME transaction as the write that caused them, so
-- an event can never describe a write that rolled back. A relay process (worker
-- entrypoint) claims unpublished rows in id order and stamps published_at.
-- Append-only in practice; the only UPDATE is the relay setting published_at,
-- so there is no touch trigger and no updated_at.
--
-- `event_type` carries the version suffix (brew.logged.v1, recipe.forked.v1) —
-- versioned, append-only contracts, consumers tolerate unknown payload fields
-- (EF §1.2).
-- ----------------------------------------------------------------------------
CREATE TABLE domain_events (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id       uuid        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  event_type     text        NOT NULL CHECK (event_type ~ '^[a-z][a-z_]*\.[a-z][a-z_]*\.v[0-9]+$'),
  aggregate_type text        NOT NULL,
  aggregate_id   text        NOT NULL,   -- text: aggregates are not uniformly uuid
  actor_id       uuid,                   -- acting user; NULL = system
  payload        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);

-- The relay's claim query: unpublished rows, in emission order.
CREATE INDEX idx_domain_events_unpublished ON domain_events (id) WHERE published_at IS NULL;
CREATE INDEX idx_domain_events_type_time   ON domain_events (event_type, occurred_at DESC);
CREATE INDEX idx_domain_events_aggregate   ON domain_events (aggregate_type, aggregate_id);
CREATE INDEX idx_domain_events_occurred    ON domain_events (occurred_at);  -- retention sweep

-- ----------------------------------------------------------------------------
-- grind_conversions.data_points is added by 0004 (catalog search/indexes). This
-- statement is a no-op on any database that has 0004 applied and exists only so
-- a database migrated 0001→0003→0006 (the brewing test harness, which cannot
-- run 0004's pg_trgm bits under PGlite) still satisfies GC-02's counter. It is
-- deliberately identical to 0004's definition.
-- ----------------------------------------------------------------------------
ALTER TABLE grind_conversions
  ADD COLUMN IF NOT EXISTS data_points integer NOT NULL DEFAULT 1;
