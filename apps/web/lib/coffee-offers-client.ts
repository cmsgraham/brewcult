/**
 * Prices and the shops that quote them (0018).
 *
 * Formatting lives here rather than in the component so a colón is written the
 * same way on every surface. `Intl` does the work — a hand-rolled thousands
 * separator gets Costa Rica wrong (₡8 500, not ₡8,500) and nobody notices until
 * somebody local does.
 */
import { apiFetch, type ApiRequestOptions } from './api';

export interface Vendor {
  id: string;
  name: string;
  slug: string;
  location: string | null;
  verified: boolean;
  roaster_id: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  maps_url: string | null;
  shop_url: string | null;
}

export interface CoffeeOffer {
  id: string;
  vendor: Vendor;
  size_grams: number;
  /** As quoted. Never converted from the other currency. */
  price_crc: number | null;
  price_usd: number | null;
  price_crc_per_kg: number | null;
  price_usd_per_kg: number | null;
  /** The other currency, approximated at read time. Rendered with a ≈, never bare. */
  price_usd_approx: number | null;
  price_crc_approx: number | null;
  fx_crc_per_usd: number | null;
  url: string | null;
  in_stock: boolean;
  /** The date this price was true. A price without one is a rumour. */
  quoted_on: string;
}

const path = (slug: string): string => `/api/v1/coffees/${encodeURIComponent(slug)}/offers`;

export async function fetchOffers(
  slug: string,
  options?: ApiRequestOptions,
): Promise<CoffeeOffer[]> {
  const body = await apiFetch<{ items?: CoffeeOffer[] }>(path(slug), options);
  return body?.items ?? [];
}

export interface OfferInput {
  vendor: {
    name: string;
    location?: string;
    phone?: string;
    whatsapp?: string;
    email?: string;
    website_url?: string;
    instagram_url?: string;
    facebook_url?: string;
    maps_url?: string;
    shop_url?: string;
  };
  size_grams: number;
  price_crc?: number;
  price_usd?: number;
  url?: string;
  in_stock?: boolean;
}

export async function addOffer(
  slug: string,
  input: OfferInput,
  options?: ApiRequestOptions,
): Promise<CoffeeOffer[]> {
  const body = await apiFetch<{ items?: CoffeeOffer[] }>(path(slug), {
    ...options,
    method: 'POST',
    body: input,
  });
  return body?.items ?? [];
}

/**
 * "8.500", "8,500", "₡8500" are all eight and a half thousand colones. Costa
 * Rica writes thousands with a dot, and there are no céntimos in practice, so
 * EVERY separator is a thousands separator here. Parsing this like a dollar
 * amount reads 8.500 as eight-and-a-half — which saves without an error and is
 * wrong by three orders of magnitude.
 */
export function parseColones(raw: string): number | undefined {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits === '') return undefined;
  return Number(digits);
}

/** Dollars: dot is the decimal, commas are thousands, everything else noise. */
export function parseDollars(raw: string): number | undefined {
  const cleaned = raw.replace(/[^\d.]/g, '');
  if (cleaned === '' || cleaned === '.') return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

/** ₡8 500 — no decimals, because nobody prices coffee in céntimos. */
export function formatColones(value: number): string {
  return new Intl.NumberFormat('es-CR', {
    style: 'currency',
    currency: 'CRC',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDollars(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}
