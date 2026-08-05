-- ============================================================================
-- 0010_user_equipment.sql — the gear a person actually owns
--
-- Purpose: let somebody say "this is my grinder" once, instead of the product
--   inferring it from whatever they last logged.
--
-- ── WHY DERIVING IT FROM BREWS WAS NOT ENOUGH ───────────────────────────────
-- 0006 records `brewer_model_id` and `grinder_model_id` on each brew, and the
-- AI tool layer derives "their setup" from those (intelligence/tools/registry
-- says so, and predicted this table). Derivation breaks in the cases that
-- matter most:
--
--   * a NEW user has logged nothing, so the assistant has no idea what they own
--     — which is exactly when good advice matters most
--   * gear you own but rarely use disappears from the derived set
--   * gear you SOLD keeps showing up forever
--   * the grind converter needs a "from" and a "to" grinder; deriving only ever
--     gives you the one you last used
--
-- ── INTENTIONALLY THIN ──────────────────────────────────────────────────────
-- A row is a claim of ownership and nothing else. No purchase date, no price,
-- no condition, no photos. Every one of those is a field somebody has to
-- maintain by hand, and none of them changes a single brewing suggestion.
-- second_draft §10 is explicit that the product asks for what it will use.
--
-- The catalogue stays the source of truth for what a device IS: a row here is
-- a FK, so specs and grind-scale types are never copied and never drift.
-- `nickname` is the one free-text field, because two of the same grinder set
-- differently is a real thing people do ("café EK", "home EK").
-- ============================================================================

CREATE TABLE user_equipment (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  equipment_model_id uuid        NOT NULL REFERENCES equipment_models (id) ON DELETE CASCADE,

  -- Free text only where the catalogue genuinely cannot answer: two identical
  -- grinders kept at different settings.
  nickname           text        CONSTRAINT user_equipment_nickname_len
                                   CHECK (nickname IS NULL OR char_length(nickname) <= 60),

  -- The one you mean when you say "my grinder". At most one per CATEGORY per
  -- person — enforced by a partial unique index below rather than by trusting
  -- the API, because "which grinder is the default" silently having two answers
  -- makes the grind converter pick one at random.
  is_primary         boolean     NOT NULL DEFAULT false,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- Owning the same model twice is a data-entry mistake, not a real state.
  CONSTRAINT uq_user_equipment_model UNIQUE (user_id, equipment_model_id)
);

CREATE TRIGGER trg_user_equipment_touch
  BEFORE UPDATE ON user_equipment
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- "What do I own?" — the only read this table gets on a hot path.
CREATE INDEX idx_user_equipment_owner
  ON user_equipment (user_id, created_at DESC);

-- ONE primary per category per person. The category lives on equipment_models,
-- not here, so this cannot be a plain unique index over local columns; the
-- API resolves the category and writes it into `primary_category` so the
-- constraint has something local to enforce. Denormalised on purpose, and the
-- FK above keeps it honest because the model cannot change category.
ALTER TABLE user_equipment
  ADD COLUMN primary_category text;

CREATE UNIQUE INDEX uq_user_equipment_one_primary_per_category
  ON user_equipment (user_id, primary_category)
  WHERE is_primary = true;

COMMENT ON TABLE user_equipment IS
  'Ownership claims. The catalogue owns what a device IS — see the 0010 header.';
COMMENT ON COLUMN user_equipment.primary_category IS
  'Mirror of equipment_models.category, written by the API so the one-primary-per-category index has a local column. NULL when is_primary = false.';
