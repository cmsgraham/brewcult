/**
 * Notes on a coffee (0016).
 *
 * Reads are public, so the list call works signed out — a coffee page whose
 * notes only appear after a login is a page that looks empty to the person
 * deciding whether to make an account.
 */
import { apiFetch, type ApiRequestOptions } from './api';

export interface CoffeeReview {
  id: string;
  coffee_product_id: string;
  author_handle: string | null;
  author_display_name: string | null;
  rating: number;
  body: string | null;
  brew_method: string | null;
  helpful_count: number;
  /** Null for a signed-out reader — "unknown", not "no". */
  voted_helpful: boolean | null;
  is_mine: boolean;
  created_at: string;
  updated_at: string;
}

export interface CoffeeRatingSummary {
  average: number | null;
  count: number;
}

export interface ReviewsResponse {
  items: CoffeeReview[];
  summary: CoffeeRatingSummary;
}

const base = (slug: string): string => `/api/v1/coffees/${encodeURIComponent(slug)}/reviews`;

export async function fetchCoffeeReviews(
  slug: string,
  options?: ApiRequestOptions,
): Promise<ReviewsResponse> {
  const body = await apiFetch<ReviewsResponse>(base(slug), options);
  return { items: body?.items ?? [], summary: body?.summary ?? { average: null, count: 0 } };
}

/** Leave a note or change the one you left — the API upserts either way. */
export async function saveMyReview(
  slug: string,
  input: { rating: number; body?: string; brew_method?: string },
  options?: ApiRequestOptions,
): Promise<ReviewsResponse> {
  const body = await apiFetch<ReviewsResponse>(`${base(slug)}/mine`, {
    ...options,
    method: 'PUT',
    body: input,
  });
  return { items: body?.items ?? [], summary: body?.summary ?? { average: null, count: 0 } };
}

export async function deleteMyReview(
  slug: string,
  options?: ApiRequestOptions,
): Promise<ReviewsResponse> {
  const body = await apiFetch<ReviewsResponse>(`${base(slug)}/mine`, {
    ...options,
    method: 'DELETE',
  });
  return { items: body?.items ?? [], summary: body?.summary ?? { average: null, count: 0 } };
}

/** A toggle: the same call marks useful and un-marks it. */
export async function toggleHelpful(
  slug: string,
  reviewId: string,
  options?: ApiRequestOptions,
): Promise<ReviewsResponse> {
  const body = await apiFetch<ReviewsResponse>(
    `${base(slug)}/${encodeURIComponent(reviewId)}/helpful`,
    { ...options, method: 'POST' },
  );
  return { items: body?.items ?? [], summary: body?.summary ?? { average: null, count: 0 } };
}
