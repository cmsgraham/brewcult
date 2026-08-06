-- ============================================================================
-- 0018_vendors_and_prices.sql — where to buy it, and what it costs
--
-- ── WHY PRICE IS NOT A COLUMN ON coffee_products ────────────────────────────
-- Because a coffee does not have a price. A 340g bag at one shop has a price;
-- the same coffee at the roastery, in a kilo, has another; the same bag next
-- month has a third. A price column would be silently wrong the moment a second
-- shop stocked it, and there would be nowhere to record which one it was.
--
-- So an OFFER: this vendor, this size, this price, as of this date.
--
-- ── TWO CURRENCIES, BOTH STORED ─────────────────────────────────────────────
-- Colones and dollars are both kept as entered, and NEITHER is converted from
-- the other. A stored conversion is a lie with a timestamp: the rate moves, the
-- shop's dollar price does not track it, and a computed ₡ price drifts from the
-- number on the shelf. Whoever enters the offer types what the vendor actually
-- charges, in whichever currencies they actually quote.
--
-- Money is `numeric`, never float. Colones have no minor unit in practice, but
-- the column carries two decimals anyway so a dollar price is exact.
--
-- ── VENDORS ARE NOT ROASTERS ────────────────────────────────────────────────
-- Often the same business, sometimes not: a café sells four roasters' coffee,
-- and a roaster sells through three shops. Separate tables, joined by the offer
-- — the alternative is contact details duplicated onto every coffee, going
-- stale independently.
-- ============================================================================

CREATE TABLE vendors (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  slug        text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  -- When the vendor IS a roaster already in the catalogue. Keeps one business
  -- from having two half-filled pages.
  roaster_id  uuid        REFERENCES roasters (id) ON DELETE SET NULL,

  -- City-level, human-entered — the same minimisation rule roasters follow. No
  -- street addresses: this is a directory, not a delivery service.
  location    text        CHECK (location IS NULL OR char_length(location) <= 120),

  -- ── How to reach them ────────────────────────────────────────────────────
  -- Stored as the vendor gives them, validated only for shape. A phone number
  -- is E.164 when we can get it and free text when we cannot, because refusing
  -- "8888-8888" from a Costa Rican shop would mean recording nothing at all.
  phone        text CHECK (phone IS NULL OR char_length(phone) <= 40),
  whatsapp     text CHECK (whatsapp IS NULL OR char_length(whatsapp) <= 40),
  email        citext CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),

  -- URLs are stored whole and checked for scheme. http(s) ONLY: a javascript:
  -- or data: URL in a link somebody else clicks is the oldest trick there is.
  website_url   text CHECK (website_url  IS NULL OR website_url  ~* '^https?://[^[:space:]]{3,300}$'),
  instagram_url text CHECK (instagram_url IS NULL OR instagram_url ~* '^https?://[^[:space:]]{3,300}$'),
  facebook_url  text CHECK (facebook_url  IS NULL OR facebook_url  ~* '^https?://[^[:space:]]{3,300}$'),
  maps_url      text CHECK (maps_url      IS NULL OR maps_url      ~* '^https?://[^[:space:]]{3,300}$'),
  shop_url      text CHECK (shop_url      IS NULL OR shop_url      ~* '^https?://[^[:space:]]{3,300}$'),

  -- Same meaning as on roasters: somebody typed this, or we know the business.
  verified     boolean     NOT NULL DEFAULT false,
  source       text        NOT NULL DEFAULT 'community'
                           CHECK (source IN ('editorial', 'community')),
  submitted_by uuid        REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at  timestamptz,
  reviewed_by  uuid        REFERENCES users (id) ON DELETE SET NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_vendors_name ON vendors (lower(name));
CREATE INDEX idx_vendors_roaster ON vendors (roaster_id);
CREATE INDEX idx_vendors_unreviewed
  ON vendors (created_at DESC)
  WHERE source = 'community' AND reviewed_at IS NULL;

CREATE TRIGGER trg_vendors_touch
  BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- What it costs, where, in what size.
-- ----------------------------------------------------------------------------
CREATE TABLE coffee_offers (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  coffee_product_id uuid        NOT NULL REFERENCES coffee_products (id) ON DELETE CASCADE,
  vendor_id         uuid        NOT NULL REFERENCES vendors (id) ON DELETE CASCADE,

  -- The bag this price is for. 340g and 1kg are different offers, and a price
  -- with no size attached cannot be compared with anything.
  size_grams  integer     NOT NULL CHECK (size_grams BETWEEN 10 AND 20000),

  -- Both as quoted. Neither computed from the other — see the header.
  price_crc   numeric(12, 2) CHECK (price_crc IS NULL OR price_crc >= 0),
  price_usd   numeric(10, 2) CHECK (price_usd IS NULL OR price_usd >= 0),

  url         text CHECK (url IS NULL OR url ~* '^https?://[^[:space:]]{3,300}$'),
  in_stock    boolean     NOT NULL DEFAULT true,

  -- A price is a claim about a moment. Without this the oldest number on the
  -- page looks exactly like the newest one.
  quoted_on   date        NOT NULL DEFAULT current_date,

  submitted_by uuid       REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- An offer with no price in either currency is not an offer.
  CONSTRAINT coffee_offers_has_a_price CHECK (price_crc IS NOT NULL OR price_usd IS NOT NULL),

  -- One live offer per vendor per size. A second is an UPDATE, not a duplicate.
  UNIQUE (coffee_product_id, vendor_id, size_grams)
);

CREATE INDEX idx_coffee_offers_coffee ON coffee_offers (coffee_product_id, in_stock, quoted_on DESC);
CREATE INDEX idx_coffee_offers_vendor ON coffee_offers (vendor_id);

CREATE TRIGGER trg_coffee_offers_touch
  BEFORE UPDATE ON coffee_offers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- Roasters get the same contact details, because a roaster IS a vendor most of
-- the time and making somebody create a duplicate vendor row to record a phone
-- number is the kind of paperwork that means the number never gets recorded.
-- ----------------------------------------------------------------------------
ALTER TABLE roasters
  ADD COLUMN phone         text CHECK (phone IS NULL OR char_length(phone) <= 40),
  ADD COLUMN whatsapp      text CHECK (whatsapp IS NULL OR char_length(whatsapp) <= 40),
  ADD COLUMN website_url   text CHECK (website_url   IS NULL OR website_url   ~* '^https?://[^[:space:]]{3,300}$'),
  ADD COLUMN instagram_url text CHECK (instagram_url IS NULL OR instagram_url ~* '^https?://[^[:space:]]{3,300}$'),
  ADD COLUMN facebook_url  text CHECK (facebook_url  IS NULL OR facebook_url  ~* '^https?://[^[:space:]]{3,300}$'),
  ADD COLUMN maps_url      text CHECK (maps_url      IS NULL OR maps_url      ~* '^https?://[^[:space:]]{3,300}$');

COMMENT ON TABLE coffee_offers IS
  'This vendor, this size, this price, on this date. Prices are stored as quoted in each currency and never converted between them — see 0018.';
COMMENT ON COLUMN vendors.verified IS
  'We have confirmed this is the business it claims to be. Community submissions are NEVER verified.';
