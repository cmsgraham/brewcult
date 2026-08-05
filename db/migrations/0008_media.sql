-- ============================================================================
-- 0008_media.sql — media module (Lane M), backlog BREW-06
--
-- Purpose: the ONE media pipeline every other surface attaches to — user
--   avatars, brew photos, and staff-uploaded catalog imagery (coffee bags,
--   equipment shots, roaster logos). Before this migration BrewCult had no
--   image support at all: 0006 shipped `brew_sessions.photo_media_id` as a bare
--   uuid with the comment "FK lands with BREW-06 (media table)". This is that
--   migration, and it closes that FK.
--
-- The pipeline this table records is deliberately NOT a blind presigned PUT.
--   EF §3.5 requires "allowlisted MIME types verified by content sniffing (not
--   extension), size caps, image re-encode (kills polyglot/steg payloads and
--   strips EXIF including GPS)". None of that can happen if the client writes
--   straight to object storage, so the API is in the byte path: it sniffs magic
--   bytes, re-encodes through sharp, and only then writes the object and this
--   row. A row here therefore means "these bytes were decoded and re-emitted by
--   our own encoder", which is the property the rest of the platform relies on.
--
-- ── TABLE OWNERSHIP: FOUR DOCUMENTED EXCEPTIONS ─────────────────────────────
-- This migration adds a nullable attachment column to FOUR tables owned by
-- other modules:
--
--     users.avatar_media_id             (identity, 0002)
--     coffee_products.image_media_id    (catalog,  0003)
--     equipment_models.image_media_id   (catalog,  0003)
--     roasters.image_media_id           (catalog,  0003)
--
-- 0007 was able to say "adds NO column to an identity-owned table". This one
-- cannot, and the exception is deliberate rather than accidental:
--
--   * The alternative — a media-owned `media_attachments(media_id, target_type,
--     target_id)` join table — moves the coupling rather than removing it, and
--     it costs the database's own referential integrity: a join row can point
--     at a coffee product that no longer exists, and "which image does this
--     coffee use?" becomes a join with an application-enforced at-most-one rule
--     instead of a nullable column with a FK. For a strict 0..1 relationship a
--     nullable FK column IS the minimum-coupling option; a join table is the
--     minimum-coupling option only for 0..N.
--
--   * The coupling is one nullable column per table, with ON DELETE SET NULL,
--     defaulting to NULL. Every existing row, query, INSERT and CHECK in
--     0002/0003 keeps working untouched, and every module that never selects
--     the column cannot observe it.
--
--   * `brew_sessions.photo_media_id` (0006) is the same relationship and was
--     designed exactly this way by the brewing lane, with the FK explicitly
--     deferred to this migration. Attaching brew photos through a join table
--     while every other kind uses a column would have left the platform with
--     two attachment mechanisms and two sources of truth — and brewing's
--     repository, sync projection and body_hash already read the column.
--
-- The WRITE path stays as narrow as the column: the media module writes exactly
-- these four columns and nothing else in those tables, from two audited routes
-- (`PUT /v1/users/me/avatar`, `PUT /v1/admin/media/attach`). The clean end state
-- is identity publishing `setUserAvatar()` and catalog publishing
-- `setEntityImage()`; when they do, there is exactly one UPDATE each to delete.
-- Recorded in the lane report.
--
-- A FIFTH cross-module change is the FK 0006 asked for
-- (`brew_sessions.photo_media_id`), plus the index that FK needs: an ON DELETE
-- SET NULL constraint with no index on the child column turns every media
-- deletion into a sequential scan of brew_sessions. Indexes are added for the
-- same reason on the four attachment columns (partial — NULL is the common
-- case, so the index stays tiny).
--
-- ── DATA CLASSIFICATION (EF §4.1) & RETENTION (EF §4.2) ─────────────────────
--   media (kind='brew_photo')   P1 pseudonymous activity, and the most
--                               sensitive P1 the platform holds: a brew photo
--                               is taken in the user's KITCHEN. The original
--                               file routinely carries EXIF GPS accurate to a
--                               few metres — i.e. the user's home address —
--                               which EF §4.1 forbids the platform to hold at
--                               all ("no precise geolocation ever"). The
--                               re-encode step is therefore not a nice-to-have:
--                               it is the control that keeps this table inside
--                               the classification. The uploaded bytes are
--                               never persisted; only the re-encoded output is,
--                               and it carries NO metadata block of any kind.
--                               Retention: account life. Hard-deleted with the
--                               account (ON DELETE CASCADE) within 30 days
--                               (EF §4.3).
--   media (kind='avatar')       P1. A face is personal data but the user chose
--                               to publish it; the projection is public wherever
--                               the profile is. Same retention as above.
--   media (kind='coffee_image'| P0 Public — editorial catalog assets, no
--         'equipment_image'|    personal linkage at all. `owner_id` is NULL for
--         'roaster_logo')       these by design (see below). Retention:
--                               catalog life, independent of any staff account.
--   media.checksum_sha256       P1 operational. Content hash of the STORED
--                               (re-encoded) bytes, not of the upload — it is a
--                               integrity/debug aid, never a dedup key across
--                               users (that would leak "someone else uploaded
--                               this exact image").
--   media.uploaded_by           P1 provenance, staff uploads only. SET NULL on
--                               account deletion — the durable record of who
--                               uploaded a catalog asset lives in `audit_log`.
--
-- OWNER SEMANTICS AND WHY owner_id IS NULLABLE
--   owner_id is the SUBJECT of the media, not merely whoever pressed upload:
--     * avatar / brew_photo  → the user. ON DELETE CASCADE, because a deleted
--       account must not leave its kitchen photos behind. This is the
--       privacy-safe default: the row disappears even if the deletion job never
--       runs.
--     * catalog kinds        → NULL. A roaster logo is platform content; if it
--       carried the uploading editor's id, that editor closing their account
--       would silently delete published catalog imagery. `uploaded_by` keeps
--       the provenance without the cascade.
--
--   OBJECT-STORAGE CAVEAT: a FK cascade deletes the ROW, not the object in
--   MinIO/S3. The account-deletion job (BREW-10) must enumerate the user's
--   storage keys and purge the objects BEFORE deleting the user; the media
--   module publishes `listOwnedStorageKeys()` for exactly that. The ordinary
--   application path (DELETE /v1/media/:id) removes the objects first and only
--   then marks the row 'deleted', so the two never disagree.
--
-- Conventions match 0002/0003/0006/0007: uuid PKs via gen_random_uuid(),
--   created_at/updated_at plus the shared touch_updated_at() trigger,
--   CHECK-constrained controlled vocabularies mirrored by the JSON schemas in
--   modules/media/schemas.ts (a bad value is a 400, not a 500).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- media — one row per stored image.
--
-- `storage_key` is the object key of the normalised original;
-- `thumbnail_key` the 400px derivative. Both are unguessable (128 bits of
-- randomness in the filename), which is what lets the objects be served
-- straight from the cookie-less media origin (EF §3.5, DG §5.3
-- media.brewcult.coffee) instead of being proxied through the API. Absolute
-- URLs are derived from MEDIA_BASE_URL at read time and never stored: the
-- deployment can move buckets or put a CDN in front without a data migration.
--
-- `status` is the upload lifecycle, not a moderation state:
--   pending  row reserved, bytes not yet durable (only ever observed inside the
--            upload transaction; a crashed upload leaves one behind for the GC
--            sweep to find)
--   ready    bytes are in object storage and the row is usable
--   failed   processing rejected the input; no object was written
--   deleted  soft-deleted, objects already removed from storage. Kept so that
--            an attachment column pointing here degrades to "image missing"
--            rather than dangling, and so deletion is auditable.
-- Nothing outside this module may attach media that is not 'ready' — enforced
-- by `assertMediaUsable()` in modules/media/index.ts, which is the seam brewing
-- calls before writing photo_media_id.
-- ----------------------------------------------------------------------------
CREATE TABLE media (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL = platform/system-owned (staff catalog uploads). See header.
  owner_id        uuid        REFERENCES users(id) ON DELETE CASCADE,

  -- Provenance for the NULL-owner case; never used for authorization.
  uploaded_by     uuid        REFERENCES users(id) ON DELETE SET NULL,

  kind            text        NOT NULL
                              CHECK (kind IN ('avatar','brew_photo','coffee_image',
                                              'equipment_image','roaster_logo')),

  storage_key     text        NOT NULL UNIQUE,
  thumbnail_key   text        UNIQUE,

  -- MIME of what we STORED (our encoder's output), never what the client
  -- claimed. The client's Content-Type is not recorded anywhere on purpose:
  -- keeping it invites a future reader to trust it.
  mime_type       text        NOT NULL
                              CHECK (mime_type IN ('image/webp','image/jpeg','image/png')),

  byte_size       bigint      NOT NULL CHECK (byte_size > 0),
  width           integer     CHECK (width  > 0),
  height          integer     CHECK (height > 0),
  checksum_sha256 text        NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),

  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','ready','failed','deleted')),

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- A 'ready' row without dimensions would mean the decode step was skipped,
  -- which is the exact failure this pipeline exists to prevent. Fail loud in
  -- the database rather than serve an image nobody sniffed.
  CONSTRAINT media_ready_is_decoded CHECK (
    status <> 'ready' OR (width IS NOT NULL AND height IS NOT NULL)
  ),

  -- Catalog imagery is platform-owned; personal media always has an owner.
  CONSTRAINT media_owner_matches_kind CHECK (
    (kind IN ('avatar','brew_photo') AND owner_id IS NOT NULL) OR
    (kind IN ('coffee_image','equipment_image','roaster_logo'))
  )
);

-- The quota query and every "my uploads" listing page on (owner, recency).
CREATE INDEX idx_media_owner_created ON media (owner_id, created_at DESC, id DESC);
-- The GC sweep for 'pending' leftovers and the retention job for 'deleted'.
CREATE INDEX idx_media_status ON media (status, created_at DESC);

CREATE TRIGGER trg_media_touch
  BEFORE UPDATE ON media
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- The FK 0006 deferred to this migration.
--
-- ON DELETE SET NULL, not CASCADE: deleting a photo must never delete the brew
-- session it illustrated. The log entry is the user's data; the picture is an
-- attachment to it.
-- ----------------------------------------------------------------------------
ALTER TABLE brew_sessions
  ADD CONSTRAINT brew_sessions_photo_media_id_fkey
  FOREIGN KEY (photo_media_id) REFERENCES media(id) ON DELETE SET NULL;

CREATE INDEX idx_brew_sessions_photo_media
  ON brew_sessions (photo_media_id)
  WHERE photo_media_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Attachment columns on other modules' tables. See the header for why these are
-- columns and not a join table, and for the write-path boundary.
-- ----------------------------------------------------------------------------

-- identity (0002). The public profile projection may expose this; the private
-- one always does.
ALTER TABLE users
  ADD COLUMN avatar_media_id uuid REFERENCES media(id) ON DELETE SET NULL;

CREATE INDEX idx_users_avatar_media
  ON users (avatar_media_id)
  WHERE avatar_media_id IS NOT NULL;

-- catalog (0003). P0 public entities: once attached, the image is public too,
-- which is exactly what the media read policy keys on.
ALTER TABLE coffee_products
  ADD COLUMN image_media_id uuid REFERENCES media(id) ON DELETE SET NULL;

CREATE INDEX idx_coffee_products_image_media
  ON coffee_products (image_media_id)
  WHERE image_media_id IS NOT NULL;

ALTER TABLE equipment_models
  ADD COLUMN image_media_id uuid REFERENCES media(id) ON DELETE SET NULL;

CREATE INDEX idx_equipment_models_image_media
  ON equipment_models (image_media_id)
  WHERE image_media_id IS NOT NULL;

ALTER TABLE roasters
  ADD COLUMN image_media_id uuid REFERENCES media(id) ON DELETE SET NULL;

CREATE INDEX idx_roasters_image_media
  ON roasters (image_media_id)
  WHERE image_media_id IS NOT NULL;

COMMENT ON TABLE media IS
  'BREW-06 media pipeline (EF §3.5). Rows exist only for bytes this API decoded '
  'and re-encoded itself: sniffed by magic bytes, re-emitted by sharp, metadata '
  '(incl. EXIF GPS) discarded. Never insert a row for client-supplied bytes.';

COMMENT ON COLUMN media.owner_id IS
  'Subject of the media; NULL for platform-owned catalog imagery. Drives the '
  'read/delete policy and the account-deletion cascade.';

COMMENT ON COLUMN users.avatar_media_id IS
  'Written ONLY by the media module (PUT /v1/users/me/avatar) — see 0008 header.';

COMMENT ON COLUMN coffee_products.image_media_id IS
  'Written ONLY by the media module (PUT /v1/admin/media/attach) — see 0008 header.';

COMMENT ON COLUMN equipment_models.image_media_id IS
  'Written ONLY by the media module (PUT /v1/admin/media/attach) — see 0008 header.';

COMMENT ON COLUMN roasters.image_media_id IS
  'Written ONLY by the media module (PUT /v1/admin/media/attach) — see 0008 header.';
