-- ============================================================================
-- 0019_fix_url_checks.sql — a CHECK that could never pass
--
-- 0018 validated URLs with `~* '^https?://[^[:space:]]{3,300}$'`. Postgres's
-- POSIX engine caps a repetition count at 255 (RE_DUP_MAX), so `{3,300}` is not
-- a big number — it is a syntax error. The constraint compiled at CREATE TABLE
-- and blew up the first time a row was actually checked:
--
--     invalid regular expression: invalid repetition count(s)   [2201B]
--
-- Every insert carrying a website, an Instagram link or a shop URL 500'd. The
-- rows without one were fine, which is why it looked like "URLs are broken"
-- rather than "the constraint is".
--
-- ── THE FIX, AND WHY IT IS SHAPED THIS WAY ──────────────────────────────────
-- The regex now checks the SHAPE — scheme, then at least a few non-space
-- characters — and the LENGTH is checked with char_length(), which is what it
-- was always for. Two clauses that each say one thing beat one clause that says
-- both badly, and neither can hit an engine limit.
--
-- The rule being enforced is unchanged: http(s) only. A javascript: or data:
-- URL in a link somebody else clicks is the oldest trick there is.
-- ============================================================================

CREATE OR REPLACE FUNCTION is_web_url(value text) RETURNS boolean AS $$
  SELECT value IS NULL
      OR (value ~* '^https?://[^[:space:]]{3,}$' AND char_length(value) <= 300);
$$ LANGUAGE sql IMMUTABLE;

COMMENT ON FUNCTION is_web_url(text) IS
  'http(s) only, shape checked by regex and length checked separately — see 0019 for why the two are not one expression.';

-- ---------------------------------------------------------------------------
-- vendors
-- ---------------------------------------------------------------------------
ALTER TABLE vendors
  DROP CONSTRAINT vendors_website_url_check,
  DROP CONSTRAINT vendors_instagram_url_check,
  DROP CONSTRAINT vendors_facebook_url_check,
  DROP CONSTRAINT vendors_maps_url_check,
  DROP CONSTRAINT vendors_shop_url_check;

ALTER TABLE vendors
  ADD CONSTRAINT vendors_website_url_check   CHECK (is_web_url(website_url)),
  ADD CONSTRAINT vendors_instagram_url_check CHECK (is_web_url(instagram_url)),
  ADD CONSTRAINT vendors_facebook_url_check  CHECK (is_web_url(facebook_url)),
  ADD CONSTRAINT vendors_maps_url_check      CHECK (is_web_url(maps_url)),
  ADD CONSTRAINT vendors_shop_url_check      CHECK (is_web_url(shop_url));

-- ---------------------------------------------------------------------------
-- coffee_offers
-- ---------------------------------------------------------------------------
ALTER TABLE coffee_offers
  DROP CONSTRAINT coffee_offers_url_check;

ALTER TABLE coffee_offers
  ADD CONSTRAINT coffee_offers_url_check CHECK (is_web_url(url));

-- ---------------------------------------------------------------------------
-- roasters
-- ---------------------------------------------------------------------------
ALTER TABLE roasters
  DROP CONSTRAINT roasters_website_url_check,
  DROP CONSTRAINT roasters_instagram_url_check,
  DROP CONSTRAINT roasters_facebook_url_check,
  DROP CONSTRAINT roasters_maps_url_check;

ALTER TABLE roasters
  ADD CONSTRAINT roasters_website_url_check   CHECK (is_web_url(website_url)),
  ADD CONSTRAINT roasters_instagram_url_check CHECK (is_web_url(instagram_url)),
  ADD CONSTRAINT roasters_facebook_url_check  CHECK (is_web_url(facebook_url)),
  ADD CONSTRAINT roasters_maps_url_check      CHECK (is_web_url(maps_url));
