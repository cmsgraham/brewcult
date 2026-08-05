-- ============================================================================
-- 0007_admin.sql — admin / operations lane (Lane K)
--
-- Purpose: the operator surface the platform was missing. RBAC roles and
--   staff-gated policies existed since 0002, but there was no way to create the
--   first admin, suspend an abusive account, promote a seller, triage a report
--   or read the audit trail. 0007 adds the two tables that surface needs:
--
--     admin_seller_applications  — Phase-4 marketplace INTAKE only (EF §3.6 is
--                                  the gate for stores/verification/payments;
--                                  this table is the queue that ends in a
--                                  `seller_owner` role grant, nothing more).
--     reports                    — the moderation queue (EF §3.2 "moderation
--                                  actions are audit-logged", §3.7).
--
--   Everything else the admin module needs already exists: `users.role` /
--   `users.status` (0002), the append-only `audit_log` (0002) and the
--   refresh-token families it revokes on suspension (0002/0005). This migration
--   deliberately adds NO column to, and NO index on, an identity-owned table —
--   the admin module writes those tables only through identity's published
--   writers (EF §1.2 table ownership).
--
-- Data classification (EF §4.1) & retention (EF §4.2) — per personal-data column:
--   admin_seller_applications.business_name   P2 (business identity)  retained for account life
--   admin_seller_applications.contact_email   P2                      hard-deleted with the account (FK cascade)
--   admin_seller_applications.notes           P2 (user-authored)      deleted with account
--   reports.reporter_id                       P2 (links a person to an accusation) — staff-only
--                                             projection, never exposed to the reported party
--   reports.detail                            P2 (user-authored free text) deleted with the reporter's account
--   reports.resolution                        P1 (staff-authored)     moderation record: retained per
--                                             legal minimum (EF §4.2 "moderation records"), which is why
--                                             the decision ALSO lands in the immutable audit_log
--   Everything else here is operational metadata (P1 at most).
--
-- Conventions match 0002/0003/0006: uuid PKs via gen_random_uuid(),
--   created_at/updated_at plus the shared touch_updated_at() trigger on every
--   mutable table, CHECK-constrained controlled vocabularies (the API schemas
--   in modules/admin/schemas.ts carry the same enums so a bad value is a 400,
--   not a 500).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- admin_seller_applications — "I want to sell on BrewCult" intake.
--
-- Approval does exactly one thing: it grants the applicant the `seller_owner`
-- role (modules/admin/routes.ts), which is an ordinary audited role change.
-- No store, no verification, no payout account — those are Phase 4 (EF §3.6)
-- and MUST NOT be inferred from an approved row here.
--
-- reviewed_by has ON DELETE SET NULL rather than a cascade: a reviewer closing
-- their own account must not erase who decided an application. The immutable
-- audit_log row is the durable record either way.
-- ----------------------------------------------------------------------------
CREATE TABLE admin_seller_applications (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_name text        NOT NULL CHECK (length(btrim(business_name)) BETWEEN 2 AND 200),
  contact_email citext      NOT NULL CHECK (position('@' IN contact_email) > 1),
  notes         text        CHECK (notes IS NULL OR length(notes) <= 4000),
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','approved','rejected')),
  reviewed_by   uuid        REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- A decided application always carries WHEN it was decided; a pending one
  -- never carries a decision. Without this the "queue" can lie about itself.
  CONSTRAINT admin_seller_applications_review_consistent CHECK (
    (status =  'pending' AND reviewed_at IS NULL AND reviewed_by IS NULL) OR
    (status <> 'pending' AND reviewed_at IS NOT NULL)
  )
);

-- One LIVE application per user: re-applying while a decision is outstanding is
-- queue spam, and the API turns the resulting unique violation into a 409.
-- Rejected applicants may apply again — the partial predicate allows it.
CREATE UNIQUE INDEX uq_seller_applications_pending_per_user
  ON admin_seller_applications (user_id)
  WHERE status = 'pending';

CREATE INDEX idx_seller_applications_status_created
  ON admin_seller_applications (status, created_at DESC, id DESC);
CREATE INDEX idx_seller_applications_user_created
  ON admin_seller_applications (user_id, created_at DESC);

CREATE TRIGGER trg_seller_applications_touch
  BEFORE UPDATE ON admin_seller_applications
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- reports — user-submitted moderation queue.
--
-- target_id is TEXT, matching audit_log.target_id (0002): report targets are
-- not uniformly uuid (a comment id, a slug, an off-platform handle), and a
-- moderation queue that cannot accept a target is not a moderation queue.
-- There is deliberately no FK to the target for the same reason.
--
-- status is a state machine: open → reviewing → actioned | dismissed, and
-- open → actioned | dismissed directly. Enforced in the API (routes.ts), not
-- by a trigger — the terminal states are what the CHECK guarantees.
-- ----------------------------------------------------------------------------
CREATE TABLE reports (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text        NOT NULL
                          CHECK (target_type IN ('user','recipe','brew_session','coffee_product',
                                                 'roaster','equipment_model','post','comment','review')),
  target_id   text        NOT NULL CHECK (length(btrim(target_id)) BETWEEN 1 AND 200),
  reason      text        NOT NULL
                          CHECK (reason IN ('spam','harassment','hate_speech','misinformation',
                                            'off_topic','illegal','impersonation','other')),
  detail      text        CHECK (detail IS NULL OR length(detail) <= 4000),
  status      text        NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','reviewing','actioned','dismissed')),
  resolution  text        CHECK (resolution IS NULL OR length(resolution) <= 2000),
  reviewed_by uuid        REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reports_resolution_consistent CHECK (
    (status IN ('open','reviewing') AND reviewed_at IS NULL) OR
    (status IN ('actioned','dismissed') AND reviewed_at IS NOT NULL AND resolution IS NOT NULL)
  )
);

-- THE anti-flood rule (spec: "one open report per (reporter, target)"). A
-- partial unique index is the right tool: it costs nothing on resolved rows and
-- it is enforced by the database, so a race between two concurrent submissions
-- cannot slip a second live report through the way an application-level
-- SELECT-then-INSERT check would. `reviewing` counts as live — a report a
-- moderator has already claimed must not be re-filed underneath them.
CREATE UNIQUE INDEX uq_reports_live_per_reporter_target
  ON reports (reporter_id, target_type, target_id)
  WHERE status IN ('open','reviewing');

CREATE INDEX idx_reports_status_created   ON reports (status, created_at DESC, id DESC);
CREATE INDEX idx_reports_target           ON reports (target_type, target_id);
CREATE INDEX idx_reports_reporter_created ON reports (reporter_id, created_at DESC);
CREATE INDEX idx_reports_reviewed_by      ON reports (reviewed_by, reviewed_at DESC);

CREATE TRIGGER trg_reports_touch
  BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
