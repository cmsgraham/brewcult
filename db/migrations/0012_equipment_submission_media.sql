-- ============================================================================
-- 0012_equipment_submission_media.sql — a photo attached to a SUGGESTION
--
-- The equipment request form (0011) let people attach a photo, and uploaded it
-- as kind='equipment_image'. That was wrong, and the media module said so with
-- a 403 the moment a real person tried it.
--
-- 'equipment_image' is EDITORIAL: it is the picture that appears on a public
-- catalogue page, it is platform-owned (owner_id NULL by design), and uploading
-- one is staff-only and MFA-gated. That rule is right and stays.
--
-- What a submitter attaches is a different thing wearing the same shape:
-- EVIDENCE for a review. It belongs to them, it is never published, and it
-- exists so a reviewer can see what they are looking at. Reusing the editorial
-- kind for it would have meant either handing every account the ability to
-- write catalogue imagery, or leaving the feature broken. So it gets its own
-- kind, self-serve and owned.
--
-- Consequences of it being its own kind, all of them deliberate:
--   * owner_id is NOT NULL — it is personal media, so account deletion takes
--     the objects with it (the cascade + the storage-key sweep in 0008)
--   * nothing in ATTACHMENTS points at it, so `public_attachment` is false
--     forever: readable by its owner and by staff, and by nobody else
--   * the reviewer sees it because they are staff, not because it is public
-- ============================================================================

ALTER TABLE media
  DROP CONSTRAINT media_kind_check;

ALTER TABLE media
  ADD CONSTRAINT media_kind_check CHECK (
    kind IN ('avatar','brew_photo','coffee_image','equipment_image','roaster_logo',
             'equipment_submission')
  );

-- Personal media always has an owner; only the editorial kinds may be
-- platform-owned. A submission photo is personal, so it joins the first list.
ALTER TABLE media
  DROP CONSTRAINT media_owner_matches_kind;

ALTER TABLE media
  ADD CONSTRAINT media_owner_matches_kind CHECK (
    (kind IN ('avatar','brew_photo','equipment_submission') AND owner_id IS NOT NULL)
    OR (kind IN ('coffee_image','equipment_image','roaster_logo'))
  );

COMMENT ON COLUMN media.kind IS
  'What the image is for. The self-serve kinds (avatar, brew_photo, equipment_submission) are personal and owned; the editorial kinds (coffee_image, equipment_image, roaster_logo) are platform content and staff-only to upload. See 0012.';
