/**
 * "What is in my cupboard" transport (0014).
 *
 * Paths in their PUBLIC form (`/api/v1/...`), like every other client here —
 * Caddy strips `/api` server-side, and the web↔api contract test checks these
 * against the real router.
 */
import { apiFetch, type ApiRequestOptions } from './api';

export const MY_COFFEES_PATH = '/api/v1/my-coffees';
export const COFFEE_REQUESTS_PATH = '/api/v1/coffee-requests';

export interface ShelfCoffee {
  id: string;
  /** Null when this bag has no catalogue row — private to you. */
  coffee_product_id: string | null;
  slug: string | null;
  name: string;
  roaster: string | null;
  roast_level: string | null;
  tasting_notes: string[];
  roast_date: string | null;
  notes: string | null;
  finished_at: string | null;
  is_custom: boolean;
  created_at: string;
}

interface ShelfResponse {
  items: ShelfCoffee[];
}

export async function fetchShelf(options?: ApiRequestOptions): Promise<ShelfCoffee[]> {
  const body = await apiFetch<ShelfResponse>(MY_COFFEES_PATH, options);
  return body?.items ?? [];
}

/** Add a bag by hand — the fallback when there is no photo to read. */
export async function addToShelf(
  input: {
    coffee_product_id?: string;
    roaster?: string;
    name?: string;
    roast_date?: string;
    notes?: string;
  },
  options?: ApiRequestOptions,
): Promise<ShelfCoffee[]> {
  const body = await apiFetch<ShelfResponse>(MY_COFFEES_PATH, {
    ...options,
    method: 'POST',
    body: input,
  });
  return body?.items ?? [];
}

/** Finished, not deleted: past brews still point at this bag. */
export async function finishBag(
  id: string,
  options?: ApiRequestOptions,
): Promise<ShelfCoffee[]> {
  const body = await apiFetch<ShelfResponse>(
    `${MY_COFFEES_PATH}/${encodeURIComponent(id)}/finished`,
    { ...options, method: 'POST' },
  );
  return body?.items ?? [];
}

export async function removeFromShelf(
  id: string,
  options?: ApiRequestOptions,
): Promise<ShelfCoffee[]> {
  const body = await apiFetch<ShelfResponse>(`${MY_COFFEES_PATH}/${encodeURIComponent(id)}`, {
    ...options,
    method: 'DELETE',
  });
  return body?.items ?? [];
}

export interface CoffeeRequest {
  id: string;
  requester_handle?: string | null;
  submitted_text: string;
  image_url: string | null;
  ai_draft: {
    roaster?: string;
    name?: string;
    origin_country?: string;
    process?: string;
    roast_level?: string;
    tasting_notes?: string[];
    roast_date?: string;
    confidence?: string;
    publish_ready?: boolean;
    notes?: string;
  } | null;
  ai_error: string | null;
  status: 'pending' | 'approved' | 'rejected';
  decision_note: string | null;
  coffee_product_id: string | null;
  created_at: string;
}

/**
 * Photograph a bag.
 *
 * The photo goes through the media pipeline first and only its id is sent — the
 * same rule as equipment submissions, and the reason no raw upload ever reaches
 * the drafting path.
 */
export async function submitCoffee(
  input: { description?: string; image_media_id?: string },
  options?: ApiRequestOptions,
): Promise<CoffeeRequest[]> {
  const body = await apiFetch<{ items?: CoffeeRequest[] }>(COFFEE_REQUESTS_PATH, {
    ...options,
    method: 'POST',
    body: input,
  });
  return body?.items ?? [];
}

export async function fetchMyCoffeeRequests(
  options?: ApiRequestOptions,
): Promise<CoffeeRequest[]> {
  const body = await apiFetch<{ items?: CoffeeRequest[] }>(COFFEE_REQUESTS_PATH, options);
  return body?.items ?? [];
}
