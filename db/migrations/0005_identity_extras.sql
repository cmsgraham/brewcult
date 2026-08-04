-- ============================================================================
-- 0005_identity_extras.sql - identity module (Wave 2, Lane E)
--
-- Promoted from the module's sql/ directory by the orchestrator at Wave 2
-- integration; numbered 0005 because 0004 is the catalog search/index
-- migration. Applied by db/migrate.sh in filename order and by the identity
-- test harness after 0001..0003.
--
-- Rationale: 0002_identity.sql covers users / auth_identities / refresh_tokens /
-- login_attempts / audit_log, but backlog ID-02 (verification code, reset link),
-- ID-06 (device list), ID-07 (TOTP + recovery codes) and ID-11 (email change)
-- need storage that 0002 does not provide.
--
-- Data classification (EF §4.1) & retention (EF §4.2):
--   email_verification_codes.code_hash    P2 (auth secret, hashed)  purged 30d after expiry
--   email_verification_codes.new_email    P2                        deleted with account
--   password_reset_tokens.token_hash      P2 (auth secret, hashed)  purged 30d after expiry
--   user_mfa.secret                       P2 (auth secret)          deleted with account
--   mfa_recovery_codes.code_hash          P2 (auth secret, hashed)  deleted with account
--   refresh_tokens.user_agent / .ip       P2 (auth log)             12 months, with the row
--
-- Conventions match 0002: uuid PKs via gen_random_uuid(), created_at/updated_at
-- plus the shared touch_updated_at() trigger on every mutable table.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Device metadata for the session list (ID-06 "list devices"). Added to
-- refresh_tokens rather than a parallel table so a family's device info is
-- carried by the family's own rows.
-- ----------------------------------------------------------------------------
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS ip         inet;

-- Whether the session this family represents cleared an MFA challenge. It is
-- carried forward on every rotation, so refreshing preserves — and cannot
-- manufacture — MFA standing. Without it, a session established BEFORE the user
-- enrolled in TOTP would silently become MFA-backed on its next refresh, which
-- is a privilege escalation for staff roles (isStaff() checks actor.mfa).
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS mfa boolean NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- email_verification_codes — short (6-digit) codes, so they are Argon2id-hashed
-- and attempt-capped rather than merely SHA-256'd like the high-entropy tokens.
-- purpose = 'signup'        → confirms users.email  (15-minute expiry, DG §7.1)
-- purpose = 'email_change'  → confirms new_email, then swaps it in (ID-11)
-- ----------------------------------------------------------------------------
CREATE TABLE email_verification_codes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text        NOT NULL DEFAULT 'signup'
                          CHECK (purpose IN ('signup','email_change')),
  new_email   citext,                    -- only for purpose = 'email_change'
  code_hash   text        NOT NULL,      -- Argon2id
  attempts    integer     NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_evc_user_purpose ON email_verification_codes (user_id, purpose, created_at DESC);
CREATE INDEX idx_evc_expires      ON email_verification_codes (expires_at);

CREATE TRIGGER trg_evc_touch
  BEFORE UPDATE ON email_verification_codes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- password_reset_tokens — 1-hour, single-use (DG §7.1, ID-11).
-- 256-bit random token stored as SHA-256 only; consumed_at makes reuse fail.
-- ----------------------------------------------------------------------------
CREATE TABLE password_reset_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text        NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prt_user    ON password_reset_tokens (user_id, created_at DESC);
CREATE INDEX idx_prt_expires ON password_reset_tokens (expires_at);

CREATE TRIGGER trg_prt_touch
  BEFORE UPDATE ON password_reset_tokens
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- user_mfa — one TOTP enrolment per user (ID-07).
-- confirmed_at NULL = enrolment started but never proven, so it does NOT gate
-- login. last_time_step is RFC 6238 replay protection: a code may be used once.
-- ----------------------------------------------------------------------------
CREATE TABLE user_mfa (
  user_id        uuid        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret         text        NOT NULL,   -- base32 TOTP secret (see lane report: envelope encryption is a follow-up)
  confirmed_at   timestamptz,
  last_time_step bigint,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_user_mfa_touch
  BEFORE UPDATE ON user_mfa
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- mfa_recovery_codes — single-use fallbacks, 160-bit random, SHA-256 stored.
-- ----------------------------------------------------------------------------
CREATE TABLE mfa_recovery_codes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   text        NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);

CREATE INDEX idx_mfa_recovery_user ON mfa_recovery_codes (user_id);

CREATE TRIGGER trg_mfa_recovery_touch
  BEFORE UPDATE ON mfa_recovery_codes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
