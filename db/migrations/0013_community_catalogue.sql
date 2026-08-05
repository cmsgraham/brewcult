-- ============================================================================
-- 0013_community_catalogue.sql — the catalogue can now be written by members
--
-- 0011 put a human between a submission and the catalogue. That gate is being
-- removed by product decision: waiting on a person is a worse cost than the
-- errors the person would have caught. The assistant decides, and publication
-- is immediate.
--
-- ── WHAT REPLACES THE HUMAN ─────────────────────────────────────────────────
-- Not nothing. Three things, and they are the reason this is defensible:
--
--   1. PROVENANCE. Every row now records where it came from and who last
--      checked it. "Which of these did a model write, and has anyone looked?"
--      becomes a query rather than an archaeology project.
--   2. REVIEW AFTER THE FACT. The operator console lists community rows that no
--      human has confirmed. Correction happens after publication instead of
--      blocking it — the speed is kept, the errors stay findable.
--   3. A NARROW BAR. Auto-publication requires the assistant to say it actually
--      recognises the product, at high confidence, with a category, and for a
--      grinder a grind scale. Anything short of that still lands in the queue,
--      and the submitter is never blocked either way because their own copy is
--      recorded immediately.
--
-- The thing this deliberately does NOT do is pretend the risk is gone. A model
-- reasoning from its own knowledge will publish a wrong burr diameter
-- eventually, and the grind converter reads these rows. `reviewed_at` is how
-- somebody finds it afterwards.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Provenance on catalogue rows.
-- ----------------------------------------------------------------------------
ALTER TABLE equipment_models
  ADD COLUMN source text NOT NULL DEFAULT 'editorial'
    CHECK (source IN ('editorial', 'community')),
  -- Who submitted it. Kept when the account goes: the row stays, the link does
  -- not, which is the same rule the rest of the schema uses for authorship.
  ADD COLUMN submitted_by uuid REFERENCES users (id) ON DELETE SET NULL,
  -- When a HUMAN last confirmed the contents. NULL on a community row means
  -- nobody has looked yet — that is the operator console's work queue.
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewed_by uuid REFERENCES users (id) ON DELETE SET NULL;

COMMENT ON COLUMN equipment_models.source IS
  'editorial = seeded or entered by staff. community = written from a member submission by the assistant. See 0013.';
COMMENT ON COLUMN equipment_models.reviewed_at IS
  'When a person last confirmed this row. NULL on a community row = published but unchecked.';

-- The console''s list: unchecked community rows, newest first.
CREATE INDEX idx_equipment_models_unreviewed
  ON equipment_models (created_at DESC)
  WHERE source = 'community' AND reviewed_at IS NULL;

-- ----------------------------------------------------------------------------
-- The request row records WHO decided, including when that was nobody.
-- ----------------------------------------------------------------------------
ALTER TABLE equipment_requests
  ADD COLUMN decided_by_assistant boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN equipment_requests.decided_by_assistant IS
  'True when the assistant published or refused this without a human. decided_by is then NULL — a decision with no decider is exactly what happened.';

-- A decision needs a time and either a human or the assistant behind it. The
-- 0011 constraint allowed decided_by to be NULL, which now needs to MEAN
-- something rather than merely be permitted.
ALTER TABLE equipment_requests
  DROP CONSTRAINT equipment_requests_decision_complete;

ALTER TABLE equipment_requests
  ADD CONSTRAINT equipment_requests_decision_complete CHECK (
    (status = 'pending'
       AND decided_by IS NULL AND decided_at IS NULL AND decided_by_assistant = false)
    OR
    (status <> 'pending'
       AND decided_at IS NOT NULL
       AND (decided_by IS NOT NULL OR decided_by_assistant = true))
  );
