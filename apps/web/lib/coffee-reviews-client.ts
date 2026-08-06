/**
 * Notes on a coffee (0016).
 *
 * Reads are public, so the list call works signed out — a coffee page whose
 * notes only appear after a login is a page that looks empty to the person
 * deciding whether to make an account.
 */
import { apiFetch, type ApiRequestOptions } from './api';

/**
 * The SCA cupping form, in the order it prints. `body_score` rather than `body`
 * because the prose field already owns that name.
 */
export const SCA_FORM = [
  { key: 'fragrance_aroma', label: 'Fragrance / aroma' },
  { key: 'flavour', label: 'Flavour' },
  { key: 'aftertaste', label: 'Aftertaste' },
  { key: 'acidity', label: 'Acidity' },
  { key: 'body_score', label: 'Body' },
  { key: 'uniformity', label: 'Uniformity' },
  { key: 'balance', label: 'Balance' },
  { key: 'clean_cup', label: 'Clean cup' },
  { key: 'sweetness', label: 'Sweetness' },
] as const;

export type ScaField = (typeof SCA_FORM)[number]['key'];

/**
 * The anchors printed on the form itself. Shown next to the number because
 * "8.25" means nothing to somebody who has never cupped, and the whole reason
 * to use a standard is that it means the same thing to everybody.
 */
export const SCA_ANCHORS: { value: number; word: string }[] = [
  { value: 6, word: 'Good' },
  { value: 7, word: 'Very good' },
  { value: 8, word: 'Excellent' },
  { value: 9, word: 'Outstanding' },
  { value: 10, word: 'Exceptional' },
];

export interface CoffeeReview {
  id: string;
  coffee_product_id: string;
  author_handle: string | null;
  author_display_name: string | null;
  overall: number;
  fragrance_aroma: number | null;
  flavour: number | null;
  aftertaste: number | null;
  acidity: number | null;
  body_score: number | null;
  uniformity: number | null;
  balance: number | null;
  clean_cup: number | null;
  sweetness: number | null;
  taint_cups: number;
  fault_cups: number;
  scored_at_table: boolean;
  /** Out of 100. Null unless the whole form was filled in. */
  total_score: number | null;
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
  /** Average SCA "Overall", 6–10. The number every note carries. */
  average_overall: number | null;
  /** Average cupping score out of 100, across the notes that have one. */
  average_cupping: number | null;
  cupped_count: number;
  count: number;
}

export interface ReviewsResponse {
  items: CoffeeReview[];
  summary: CoffeeRatingSummary;
}

const base = (slug: string): string => `/api/v1/coffees/${encodeURIComponent(slug)}/reviews`;

const EMPTY_SUMMARY: CoffeeRatingSummary = {
  average_overall: null,
  average_cupping: null,
  cupped_count: 0,
  count: 0,
};

export async function fetchCoffeeReviews(
  slug: string,
  options?: ApiRequestOptions,
): Promise<ReviewsResponse> {
  const body = await apiFetch<ReviewsResponse>(base(slug), options);
  return { items: body?.items ?? [], summary: body?.summary ?? EMPTY_SUMMARY };
}

/** Leave a note or change the one you left — the API upserts either way. */
export interface SaveReviewInput {
  /** SCA "Overall", 6–10 in quarter points. The only one required. */
  overall: number;
  /** The other nine, when somebody is actually cupping. */
  fragrance_aroma?: number;
  flavour?: number;
  aftertaste?: number;
  acidity?: number;
  body_score?: number;
  uniformity?: number;
  balance?: number;
  clean_cup?: number;
  sweetness?: number;
  taint_cups?: number;
  fault_cups?: number;
  scored_at_table?: boolean;
  body?: string;
  brew_method?: string;
}

export async function saveMyReview(
  slug: string,
  input: SaveReviewInput,
  options?: ApiRequestOptions,
): Promise<ReviewsResponse> {
  const body = await apiFetch<ReviewsResponse>(`${base(slug)}/mine`, {
    ...options,
    method: 'PUT',
    body: input,
  });
  return { items: body?.items ?? [], summary: body?.summary ?? EMPTY_SUMMARY };
}

export async function deleteMyReview(
  slug: string,
  options?: ApiRequestOptions,
): Promise<ReviewsResponse> {
  const body = await apiFetch<ReviewsResponse>(`${base(slug)}/mine`, {
    ...options,
    method: 'DELETE',
  });
  return { items: body?.items ?? [], summary: body?.summary ?? EMPTY_SUMMARY };
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
  return { items: body?.items ?? [], summary: body?.summary ?? EMPTY_SUMMARY };
}
