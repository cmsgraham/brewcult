-- ============================================================================
-- 0009_notifications.sql — notifications module, transactional email only
--
-- Purpose: decide, per person and per kind, whether we are allowed to send a
--   given email — and remember that we sent it, so a job that runs twice does
--   not mail twice.
--
-- ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
-- There is no marketing here and no campaign concept. Two kinds ship now,
-- because two kinds have real triggers in Phase 1:
--
--     weekly_recap    your own brews, summarised (scheduler job)
--     recipe_forked   somebody built on a recipe you published
--
-- Community, News and Marketplace are flag-off (client-config), so "replied to
-- your post" has nothing to fire it. Building the type before the event exists
-- is how you end up with a preferences screen full of switches that control
-- nothing.
--
-- ── SECURITY MAIL IS DELIBERATELY ABSENT FROM THIS TABLE ────────────────────
-- password_changed, email_changed_notice, mfa_enabled/disabled and the
-- verification codes are NOT notification types and must never become
-- preference-controlled. They are the mechanism by which somebody discovers
-- their account is being taken over; an attacker who can flip a preference
-- could otherwise silence the alarm. identity/mailer.ts sends those directly
-- and this module never sees them.
--
-- ── ABSENCE MEANS ENABLED ───────────────────────────────────────────────────
-- No row for (user, type) means "send it". The alternative — a row per user per
-- type written at signup — means a new type silently defaults everyone to OFF
-- until a backfill runs, and a failed backfill is invisible: nothing errors,
-- the mail just never goes. Rows here therefore only ever record a DEVIATION
-- from the default, which also makes "who has opted out of what" a small table
-- rather than a full cross-product.
--
-- These are service messages about your own data, so opt-out (not opt-in) is
-- the correct default under GDPR/PECR — but every one of them carries a
-- one-click unsubscribe (RFC 8058), and the link works without signing in.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Preferences: one row per DEVIATION from the default.
-- ----------------------------------------------------------------------------
CREATE TABLE notification_preferences (
  user_id           uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  notification_type text        NOT NULL,
  email_enabled     boolean     NOT NULL DEFAULT true,
  updated_at        timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, notification_type),

  -- Mirrors NOTIFICATION_TYPES in modules/notifications/types.ts. Three copies
  -- of this vocabulary exist (here, the TS union, the JSON schema) and a test
  -- asserts they agree — the same discipline 0007 uses for admin roles.
  CONSTRAINT notification_preferences_type_known
    CHECK (notification_type IN ('weekly_recap', 'recipe_forked'))
);

CREATE TRIGGER trg_notification_preferences_touch
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMENT ON TABLE notification_preferences IS
  'Opt-OUT records. No row means the notification is enabled — see 0009 header.';

-- ----------------------------------------------------------------------------
-- Deliveries: the idempotency ledger.
-- ----------------------------------------------------------------------------
-- The scheduler is a cron-style loop with no distributed lock, and a redeploy
-- mid-run, a retry, or two schedulers during a rolling restart would all
-- re-enter the same job. `dedupe_key` is what makes a second attempt a no-op:
-- the weekly recap keys on the ISO week ('weekly_recap:2026-W32'), a fork keys
-- on the fork's id. The UNIQUE index is the actual guarantee — the check is not
-- "have we sent this?" followed by a send (which races), it is an INSERT that
-- fails if we already did.
CREATE TABLE notification_deliveries (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  notification_type text        NOT NULL,
  dedupe_key        text        NOT NULL,
  sent_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_notification_deliveries_dedupe
  ON notification_deliveries (user_id, dedupe_key);

-- "What did we send this person, most recently?" — support answering
-- "why did I get this?", and the retention sweep.
CREATE INDEX idx_notification_deliveries_user_sent
  ON notification_deliveries (user_id, sent_at DESC);

COMMENT ON COLUMN notification_deliveries.dedupe_key IS
  'Idempotency key. INSERT-and-catch-conflict, never check-then-send: the latter races.';
