-- ============================================================================
-- 0002_identity.sql
-- Purpose: identity & auth foundation per EF §2.3 (multi-provider identities,
--   rotating refresh-token families with reuse detection), DG §7.1/§7.2
--   (login_attempts, auth_identities), EF §3.2/§3.7 (append-only audit log),
--   second_draft §21.1 (User entity).
--
-- Data classification (EF §4.1) & retention (EF §4.2) — per personal-data column:
--   users.handle                 P2 (public by user choice)  retained for account life; anonymized on deletion
--   users.email                  P2  hard-deleted within 30 days of account deletion
--   users.password_hash          P2 (auth secret)            deleted with account
--   users.display_name, bio      P2 (public by user choice)  anonymized on deletion
--   users.email_verified_at      P1                          deleted with account
--   users.last_seen_at           P1                          deleted with account
--   auth_identities.provider_sub P2 (auth identifier)        deleted with account
--   auth_identities.email_at_link_time P2                    deleted with account
--   refresh_tokens.token_hash    P2 (auth secret, hashed)    purge job: expired/revoked rows deleted 30 days after expiry
--   login_attempts.email/ip/user_agent P2 (auth log)         retention 12 months (EF §4.2 "auth logs 12mo"), enforced by scheduled deletion job
--   audit_log.actor_id, payload  P1/P2 depending on action   auth events 12mo; moderation records per legal minimum (EF §4.2); append-only, never updated
--   Everything else in this file is operational metadata (P1 at most).
--
-- Conventions: uuid PKs via gen_random_uuid(); created_at/updated_at with the
--   shared touch_updated_at() trigger on every *mutable* table. login_attempts
--   and audit_log are append-only event tables: created_at only, no updated_at,
--   no touch trigger (deliberate deviation, documented in the lane report).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Shared trigger function: keep updated_at honest on every UPDATE.
-- Defined once here; reused by 0003+ (migrations apply in filename order).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- users — one row per account (second_draft §21.1, task spec: single role text
-- column rather than roles[]; multi-role can widen later without data loss).
-- password_hash is NULL for OAuth-only accounts (DG §7.2).
-- ----------------------------------------------------------------------------
CREATE TABLE users (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  handle            citext      NOT NULL UNIQUE
                                CHECK (length(handle) BETWEEN 3 AND 32),
  email             citext      NOT NULL UNIQUE,
  password_hash     text,                       -- Argon2id; NULL = OAuth-only account
  display_name      text,
  bio               text,
  status            text        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','suspended','deactivated','deleted')),
  role              text        NOT NULL DEFAULT 'user'
                                CHECK (role IN ('user','moderator','editor','seller_owner','admin')),
  email_verified_at timestamptz,
  last_seen_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_users_touch
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- auth_identities — linked third-party providers per user (EF §2.3, DG §7.2).
-- Replaces a users.google_sub column so Apple lands later without a migration.
-- Auto-link rule (provider email_verified hard gate) is enforced in app code.
-- ----------------------------------------------------------------------------
CREATE TABLE auth_identities (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider           text        NOT NULL CHECK (provider IN ('google','apple')),
  provider_sub       text        NOT NULL,      -- provider's stable subject identifier
  email_at_link_time citext,                    -- provider-reported email when linked (audit aid)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_sub)
);

CREATE INDEX idx_auth_identities_user_id ON auth_identities (user_id);

CREATE TRIGGER trg_auth_identities_touch
  BEFORE UPDATE ON auth_identities
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- refresh_tokens — rotating families with reuse detection (EF §2.3).
-- Semantics the app layer implements on top of this shape:
--   * First token of a session: new family_id (any uuid; app may reuse the row id).
--   * Rotation: mark old row rotated_at = now(), insert successor with the SAME
--     family_id. Exactly one live (rotated_at IS NULL AND revoked_at IS NULL)
--     row per family at any time.
--   * Reuse detection: presented token matches a row with rotated_at NOT NULL
--     → theft signal → UPDATE ... SET revoked_at = now() WHERE family_id = X
--     revokes the entire family in one statement (idx_refresh_tokens_family).
-- Tokens are stored hashed only (DG §7.2).
-- ----------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id  uuid        NOT NULL,
  token_hash text        NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  rotated_at timestamptz,          -- set when superseded by the next token in the family
  revoked_at timestamptz,          -- set on logout, family revocation, or admin action
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_family  ON refresh_tokens (family_id);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens (expires_at);

CREATE TRIGGER trg_refresh_tokens_touch
  BEFORE UPDATE ON refresh_tokens
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- login_attempts — Zentra-style auth telemetry (DG §7.1); feeds rate limiting,
-- lockout with backoff (EF §3.3) and the audit trail. Append-only.
-- email is recorded even for unknown accounts (anti-enumeration analytics);
-- user_id is filled when the account resolved.
-- ----------------------------------------------------------------------------
CREATE TABLE login_attempts (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email          citext,
  user_id        uuid        REFERENCES users(id) ON DELETE SET NULL,
  success        boolean     NOT NULL,
  provider       text        NOT NULL DEFAULT 'email'
                             CHECK (provider IN ('email','google','apple')),
  failure_reason text,       -- e.g. bad_password, unknown_account, locked, provider_denied
  ip             inet,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_login_attempts_email_created ON login_attempts (email, created_at);
CREATE INDEX idx_login_attempts_user_created  ON login_attempts (user_id, created_at);
CREATE INDEX idx_login_attempts_created       ON login_attempts (created_at); -- retention sweep

-- ----------------------------------------------------------------------------
-- audit_log — append-only record of auth events, role/permission changes and
-- staff actions (EF §3.2, §3.7). Immutability is enforced in-database: a
-- trigger raises on UPDATE/DELETE/TRUNCATE regardless of role, so even the
-- app role (and a compromised app) cannot rewrite history. actor_id has NO
-- foreign key on purpose: a user hard-delete must not cascade into, update,
-- or be blocked by immutable audit rows.
-- ----------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    uuid,               -- acting user/staff; NULL = system
  action      text        NOT NULL,   -- e.g. user.role_changed, auth.family_revoked
  target_type text,                   -- e.g. user, coffee_product, recipe
  target_id   text,                   -- text: targets are not uniformly uuid
  payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_actor_created  ON audit_log (actor_id, created_at);
CREATE INDEX idx_audit_log_target         ON audit_log (target_type, target_id);
CREATE INDEX idx_audit_log_created        ON audit_log (created_at); -- retention sweep

CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$;

CREATE TRIGGER trg_audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE TRIGGER trg_audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
