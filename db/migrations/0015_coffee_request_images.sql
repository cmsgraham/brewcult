-- ============================================================================
-- 0015_coffee_request_images.sql — a bag has more than one side
--
-- 0014 gave a coffee submission ONE photo, which is the wrong number. The front
-- of a bag carries the roaster and the coffee; the back carries the roast date,
-- the process, the varietal and the weight. Asking somebody to choose which
-- half of the facts to send is asking them to do the model's job.
--
-- ── WHY A TABLE RATHER THAN image_media_id_back ─────────────────────────────
-- Two columns would encode "exactly two, and one of them is the front" into the
-- schema. Real bags do not cooperate: the roast date is often stamped on a side
-- seam or a sticker, and people photograph what they can see. `position` keeps
-- the order they were taken in — which is the only thing that actually matters,
-- because the drafter reads them together as one bag.
--
-- The single column is dropped rather than kept alongside. Two places to look
-- for "the photo" is how a reader ends up trusting the emptier one.
-- ============================================================================

CREATE TABLE coffee_request_images (
  request_id uuid    NOT NULL REFERENCES coffee_requests (id) ON DELETE CASCADE,
  media_id   uuid    NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  -- 0 is whatever they sent first, which is usually the front. Nothing depends
  -- on that being true: the model is told it is looking at sides of one bag.
  position   integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 3),

  PRIMARY KEY (request_id, media_id)
);

CREATE INDEX idx_coffee_request_images_request
  ON coffee_request_images (request_id, position);

-- Carry across whatever 0014 already recorded, so no submission loses its photo.
INSERT INTO coffee_request_images (request_id, media_id, position)
SELECT id, image_media_id, 0
  FROM coffee_requests
 WHERE image_media_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE coffee_requests
  DROP CONSTRAINT coffee_requests_has_content;

ALTER TABLE coffee_requests
  DROP COLUMN image_media_id;

-- "Text or a photo" still holds, but the photo now lives in another table and a
-- row-level CHECK cannot see it. Enforced in the route instead, which is where
-- the person gets a sentence rather than a constraint name.
COMMENT ON TABLE coffee_request_images IS
  'The sides of one bag, read together. See 0015 — the front carries the name, the back carries the roast date.';
