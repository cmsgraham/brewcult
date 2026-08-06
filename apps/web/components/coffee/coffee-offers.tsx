'use client';

import { useEffect, useState } from 'react';
import { hasSessionHint, isApiError } from '../../lib/api';
import {
  addOffer,
  fetchOffers,
  formatColones,
  formatDollars,
  parseColones,
  parseDollars,
  type CoffeeOffer,
} from '../../lib/coffee-offers-client';
import { Alert } from '../ui/alert';
import { useTranslate } from '../locale-provider';

/**
 * Where to buy it, and what it costs.
 *
 * ── QUOTED IN BOLD, APPROXIMATED IN ≈ ───────────────────────────────────────
 * The shop's own number is the bold one, always. When only one currency was
 * quoted the other renders as a muted ≈ — computed at READ time at a configured
 * rate, so yesterday's entry converts at today's rate instead of freezing the
 * rate of the day it was typed. The two must never look alike: our arithmetic
 * is a convenience, the shop's price is a fact.
 *
 * ── A PRICE IS DATED ────────────────────────────────────────────────────────
 * Every row carries when it was quoted. Without that the oldest number on the
 * page looks exactly like the newest, and a stale price is worse than none —
 * somebody drives across town for it.
 */
const SIZES = [250, 340, 454, 500, 1000];

export function CoffeeOffers({ slug }: { slug: string }) {
  const t = useTranslate();
  const [offers, setOffers] = useState<CoffeeOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [vendorName, setVendorName] = useState('');
  const [location, setLocation] = useState('');
  const [size, setSize] = useState(340);
  const [crc, setCrc] = useState('');
  const [usd, setUsd] = useState('');
  const [url, setUrl] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [website, setWebsite] = useState('');
  const [instagram, setInstagram] = useState('');
  const [facebook, setFacebook] = useState('');
  const [maps, setMaps] = useState('');

  useEffect(() => {
    setSignedIn(hasSessionHint());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchOffers(slug)
      .then((items) => {
        if (!cancelled) setOffers(items);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function save(): Promise<void> {
    if (vendorName.trim() === '') return;
    // Not one parser for both: "8.500" is eight and a half thousand colones and
    // eight dollars fifty. The dollar-style parse accepted the colones form and
    // saved it three orders of magnitude wrong, without an error.
    const priceCrc = parseColones(crc);
    const priceUsd = parseDollars(usd);
    if (priceCrc === undefined && priceUsd === undefined) {
      setError(t('offers.needAPrice'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setOffers(
        await addOffer(slug, {
          vendor: {
            name: vendorName.trim(),
            ...(location.trim() ? { location: location.trim() } : {}),
            ...(phone.trim() ? { phone: phone.trim() } : {}),
            ...(whatsapp.trim() ? { whatsapp: whatsapp.trim() } : {}),
            ...(website.trim() ? { website_url: website.trim() } : {}),
            ...(instagram.trim() ? { instagram_url: instagram.trim() } : {}),
            ...(facebook.trim() ? { facebook_url: facebook.trim() } : {}),
            ...(maps.trim() ? { maps_url: maps.trim() } : {}),
          },
          size_grams: size,
          ...(priceCrc !== undefined ? { price_crc: priceCrc } : {}),
          ...(priceUsd !== undefined ? { price_usd: priceUsd } : {}),
          ...(url.trim() ? { url: url.trim() } : {}),
        }),
      );
      setOpen(false);
      setVendorName('');
      setCrc('');
      setUsd('');
      setUrl('');
    } catch (failure) {
      setError(isApiError(failure) ? failure.userMessage : t('common.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="offers-heading" className="bc-stack">
      <h2 id="offers-heading">{t('offers.heading')}</h2>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {loading ? (
        <p className="bc-muted">{t('common.loading')}</p>
      ) : offers.length === 0 ? (
        <p className="bc-muted">{t('offers.empty')}</p>
      ) : (
        <ul className="bc-offers">
          {offers.map((offer) => (
            <li key={offer.id} className="bc-offers__row">
              <span className="bc-offers__where">
                <strong>
                  {offer.url ? (
                    <a href={offer.url} rel="noreferrer nofollow" target="_blank">
                      {offer.vendor.name}
                    </a>
                  ) : (
                    offer.vendor.name
                  )}
                </strong>
                {offer.vendor.verified ? null : (
                  <span className="bc-kit__badge bc-kit__badge--quiet">
                    {t('offers.unverified')}
                  </span>
                )}
                <span className="bc-muted">
                  {[offer.vendor.location, `${offer.size_grams} g`].filter(Boolean).join(' · ')}
                </span>
                <VendorLinks vendor={offer.vendor} />
              </span>

              <span className="bc-offers__price">
                {/* Quoted prices in bold; the approximated other currency in
                    muted text with a ≈ and the rate it used. The eye should
                    never mistake our arithmetic for the shop's number. */}
                {offer.price_crc !== null ? <strong>{formatColones(offer.price_crc)}</strong> : null}
                {offer.price_usd !== null ? <strong>{formatDollars(offer.price_usd)}</strong> : null}
                {offer.price_usd_approx !== null ? (
                  <span
                    className="bc-muted"
                    title={t('offers.approxTitle', {
                      rate: offer.fx_crc_per_usd ?? 0,
                      quoted: t('offers.priceCrc'),
                    })}
                  >
                    ≈ {formatDollars(offer.price_usd_approx)}
                  </span>
                ) : null}
                {offer.price_crc_approx !== null ? (
                  <span
                    className="bc-muted"
                    title={t('offers.approxTitle', {
                      rate: offer.fx_crc_per_usd ?? 0,
                      quoted: t('offers.priceUsd'),
                    })}
                  >
                    ≈ {formatColones(offer.price_crc_approx)}
                  </span>
                ) : null}
                <span className="bc-muted">
                  {offer.price_crc_per_kg !== null
                    ? `${formatColones(offer.price_crc_per_kg)}/kg`
                    : offer.price_usd_per_kg !== null
                      ? `${formatDollars(offer.price_usd_per_kg)}/kg`
                      : ''}
                </span>
                <span className="bc-muted">
                  {offer.in_stock ? '' : `${t('offers.outOfStock')} · `}
                  {t('offers.quotedOn', { date: offer.quoted_on })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {!signedIn ? null : !open ? (
        <div className="bc-actions" style={{ marginTop: 0 }}>
          <button type="button" className="bc-button bc-button--quiet" onClick={() => setOpen(true)}>
            {t('offers.add')}
          </button>
        </div>
      ) : (
        <div className="bc-panel bc-stack">
          <div className="bc-sca-grid">
            <span className="bc-field">
              <label className="bc-kit__label" htmlFor="offer-vendor">
                {t('offers.shop')}
              </label>
              <input
                id="offer-vendor"
                className="bc-input"
                maxLength={120}
                value={vendorName}
                disabled={busy}
                onChange={(event) => setVendorName(event.target.value)}
              />
            </span>
            <span className="bc-field">
              <label className="bc-kit__label" htmlFor="offer-location">
                {t('offers.town')} <span className="bc-muted">{t('common.optional')}</span>
              </label>
              <input
                id="offer-location"
                className="bc-input"
                maxLength={120}
                value={location}
                disabled={busy}
                onChange={(event) => setLocation(event.target.value)}
              />
            </span>
            <span className="bc-field">
              <label className="bc-kit__label" htmlFor="offer-size">
                {t('offers.size')}
              </label>
              <select
                id="offer-size"
                className="bc-input"
                value={size}
                disabled={busy}
                onChange={(event) => setSize(Number(event.target.value))}
              >
                {SIZES.map((grams) => (
                  <option key={grams} value={grams}>
                    {grams} g
                  </option>
                ))}
              </select>
            </span>
          </div>

          <div className="bc-sca-grid">
            <span className="bc-field">
              <label className="bc-kit__label" htmlFor="offer-crc">
                {t('offers.priceCrc')}
              </label>
              <input
                id="offer-crc"
                className="bc-input"
                inputMode="numeric"
                placeholder="8500"
                value={crc}
                disabled={busy}
                onChange={(event) => setCrc(event.target.value)}
              />
            </span>
            <span className="bc-field">
              <label className="bc-kit__label" htmlFor="offer-usd">
                {t('offers.priceUsd')}
              </label>
              <input
                id="offer-usd"
                className="bc-input"
                inputMode="decimal"
                placeholder="16.50"
                value={usd}
                disabled={busy}
                onChange={(event) => setUsd(event.target.value)}
              />
            </span>
          </div>
          <p className="bc-muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
            {t('offers.currencyHint')}
          </p>

          <details>
            <summary>{t('offers.contacts')}</summary>
            <div className="bc-sca-grid" style={{ marginTop: '0.75rem' }}>
              {(
                [
                  ['offer-phone', t('offers.phone'), phone, setPhone, '2222-2222'],
                  ['offer-whatsapp', t('offers.whatsapp'), whatsapp, setWhatsapp, '8888-8888'],
                  ['offer-website', t('offers.website'), website, setWebsite, 'https://…'],
                  ['offer-instagram', t('offers.instagram'), instagram, setInstagram, 'https://instagram.com/…'],
                  ['offer-facebook', t('offers.facebook'), facebook, setFacebook, 'https://facebook.com/…'],
                  ['offer-maps', t('offers.maps'), maps, setMaps, 'https://maps.app.goo.gl/…'],
                ] as const
              ).map(([id, label, value, setter, placeholder]) => (
                <span className="bc-field" key={id}>
                  <label className="bc-kit__label" htmlFor={id}>
                    {label}
                  </label>
                  <input
                    id={id}
                    className="bc-input"
                    value={value}
                    placeholder={placeholder}
                    disabled={busy}
                    onChange={(event) => setter(event.target.value)}
                  />
                </span>
              ))}
            </div>
          </details>

          <span className="bc-field">
            <label className="bc-kit__label" htmlFor="offer-url">
              {t('offers.linkLabel')} <span className="bc-muted">{t('common.optional')}</span>
            </label>
            <input
              id="offer-url"
              className="bc-input"
              placeholder="https://…"
              value={url}
              disabled={busy}
              onChange={(event) => setUrl(event.target.value)}
            />
          </span>

          <div className="bc-actions" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="bc-button"
              disabled={busy || vendorName.trim() === ''}
              onClick={() => void save()}
            >
              {busy ? t('common.saving') : t('offers.submit')}
            </button>
            <button
              type="button"
              className="bc-button bc-button--quiet"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The ways to reach a shop.
 *
 * `nofollow` on every one: these are member-submitted outbound links, which is
 * precisely the shape search engines treat as link spam when it is not marked.
 */
function VendorLinks({ vendor }: { vendor: CoffeeOffer['vendor'] }) {
  const links = [
    vendor.website_url ? { href: vendor.website_url, label: 'Site' } : null,
    vendor.instagram_url ? { href: vendor.instagram_url, label: 'Instagram' } : null,
    vendor.facebook_url ? { href: vendor.facebook_url, label: 'Facebook' } : null,
    vendor.maps_url ? { href: vendor.maps_url, label: 'Map' } : null,
    // wa.me is WhatsApp's own deep link; digits only, which also strips any
    // formatting somebody typed.
    vendor.whatsapp
      ? { href: `https://wa.me/${vendor.whatsapp.replace(/\D/g, '')}`, label: 'WhatsApp' }
      : null,
    vendor.phone ? { href: `tel:${vendor.phone.replace(/[^\d+]/g, '')}`, label: vendor.phone } : null,
  ].filter((link): link is { href: string; label: string } => link !== null);

  if (links.length === 0) return null;
  return (
    <span className="bc-offers__links">
      {links.map((link) => (
        <a key={link.label} href={link.href} rel="noreferrer nofollow" target="_blank">
          {link.label}
        </a>
      ))}
    </span>
  );
}
