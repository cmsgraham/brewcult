-- ============================================================================
-- 0011_custom_equipment.sql — gear the catalogue does not know yet
--
-- Two tiers, and the split is the whole point.
--
-- TIER 1 — PERSONAL. You own something we have never heard of. You record it
--   against your own account and it works immediately: no waiting, no review,
--   and no effect on anybody else. Nothing here is public, nothing here feeds
--   grind conversions as authority, nothing here reaches an SEO page.
--
-- TIER 2 — CATALOGUE REQUEST. Optionally, that same thing is proposed for the
--   SHARED catalogue. An assistant drafts brand/model/category/specs from text
--   you paste or a photo you upload, and the draft sits in a review queue until
--   a human approves it.
--
-- ── WHY A HUMAN IS BETWEEN THE DRAFT AND THE CATALOGUE ──────────────────────
-- The catalogue is shared infrastructure: it drives grind conversions, the
-- public equipment pages, and eventually advice about somebody's actual coffee.
-- The seed data carries an explicit rule — "a wrong burr diameter in a
-- grind-conversion corpus is worse than a missing one" — and a model drafting
-- from its own knowledge WILL sometimes produce a confident, wrong 48mm. So the
-- draft is a proposal, stored as-is, and never a fact until somebody says so.
-- Same shape as admin_seller_applications in 0007.
--
-- Personal entries deliberately do NOT wait for that. Being told "your grinder
-- is under review" when you just want to log a brew is the kind of gatekeeping
-- §10 of the product design rules out.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TIER 1: user_equipment may now describe something with no catalogue row.
-- ----------------------------------------------------------------------------
ALTER TABLE user_equipment
  ALTER COLUMN equipment_model_id DROP NOT NULL;

ALTER TABLE user_equipment
  ADD COLUMN custom_brand    text,
  ADD COLUMN custom_name     text,
  ADD COLUMN custom_category text;

-- Exactly one of the two shapes, never both and never neither. Without this a
-- row could name a catalogue model AND override its brand, and every reader
-- would have to decide which one wins.
ALTER TABLE user_equipment
  ADD CONSTRAINT user_equipment_model_or_custom CHECK (
    (equipment_model_id IS NOT NULL
       AND custom_brand IS NULL AND custom_name IS NULL AND custom_category IS NULL)
    OR
    (equipment_model_id IS NULL
       AND custom_name IS NOT NULL AND custom_category IS NOT NULL)
  );

ALTER TABLE user_equipment
  ADD CONSTRAINT user_equipment_custom_category_known CHECK (
    custom_category IS NULL
    OR custom_category IN ('brewer','grinder','kettle','scale','machine','accessory')
  );

ALTER TABLE user_equipment
  ADD CONSTRAINT user_equipment_custom_len CHECK (
    (custom_brand IS NULL OR char_length(custom_brand) BETWEEN 1 AND 80)
    AND (custom_name IS NULL OR char_length(custom_name) BETWEEN 1 AND 120)
  );

-- The catalogue-model uniqueness in 0010 is a table constraint over a now-
-- nullable column: Postgres treats NULLs as distinct, so custom rows never
-- collide with it. Custom rows need their own guard, case-insensitively — a
-- person adding "Fellow Opus" twice with different capitalisation is the same
-- double-click the model path already absorbs.
CREATE UNIQUE INDEX uq_user_equipment_custom
  ON user_equipment (
    user_id,
    lower(coalesce(custom_brand, '')),
    lower(custom_name)
  )
  WHERE equipment_model_id IS NULL;

COMMENT ON COLUMN user_equipment.custom_name IS
  'Set only for gear with no catalogue row. Private to the owner — never public, never authoritative for grind conversion. See 0011.';

-- ----------------------------------------------------------------------------
-- TIER 2: proposals for the shared catalogue.
-- ----------------------------------------------------------------------------
CREATE TABLE equipment_requests (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- What the person actually said. Kept verbatim and separate from the draft so
  -- a reviewer can always see the INPUT next to what the model made of it.
  submitted_text text       NOT NULL
                            CHECK (char_length(btrim(submitted_text)) BETWEEN 1 AND 4000),
  -- An optional photo, already through the media pipeline (sniffed, re-encoded,
  -- EXIF stripped by 0008) — never a raw upload.
  image_media_id uuid       REFERENCES media (id) ON DELETE SET NULL,

  -- The assistant's proposal: {brand, name, category, grind_scale_type, specs,
  -- confidence, notes}. Stored as JSON because it is EVIDENCE, not schema — it
  -- records what was proposed even if the shape of a draft changes later.
  ai_draft      jsonb,
  ai_error      text,

  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','approved','rejected')),
  -- Why it was turned down, in words the requester can read.
  decision_note text        CHECK (decision_note IS NULL OR char_length(decision_note) <= 1000),
  decided_by    uuid        REFERENCES users (id) ON DELETE SET NULL,
  decided_at    timestamptz,

  -- Set on approval: the catalogue row this became.
  equipment_model_id uuid   REFERENCES equipment_models (id) ON DELETE SET NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- A decision needs a decider and a time; a pending request must have neither.
  CONSTRAINT equipment_requests_decision_complete CHECK (
    (status = 'pending'  AND decided_by IS NULL AND decided_at IS NULL)
    OR (status <> 'pending' AND decided_at IS NOT NULL)
  )
);

CREATE TRIGGER trg_equipment_requests_touch
  BEFORE UPDATE ON equipment_requests
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- The reviewer's queue: oldest pending first, so nothing rots at the bottom.
CREATE INDEX idx_equipment_requests_pending
  ON equipment_requests (created_at)
  WHERE status = 'pending';

CREATE INDEX idx_equipment_requests_requester
  ON equipment_requests (requester_id, created_at DESC);

-- One pending request per person per thing. Re-submitting the same gear while
-- the first is still queued is impatience, not a second request.
CREATE UNIQUE INDEX uq_equipment_requests_pending_per_text
  ON equipment_requests (requester_id, lower(btrim(submitted_text)))
  WHERE status = 'pending';

COMMENT ON COLUMN equipment_requests.ai_draft IS
  'A PROPOSAL, never a fact. Nothing here reaches equipment_models without a human approving it — see the 0011 header.';
