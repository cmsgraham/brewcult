/**
 * "What I own" transport.
 *
 * Paths are in their PUBLIC form (`/api/v1/...`) because that is what the
 * browser requests — Caddy strips `/api` server-side. The web→api contract test
 * checks these against the real router (engineering_foundations §9.1/§9.2).
 */
import { apiFetch, type ApiRequestOptions } from './api';

export const MY_EQUIPMENT_PATH = '/api/v1/my-equipment';

export type EquipmentCategory =
  | 'brewer'
  | 'grinder'
  | 'kettle'
  | 'scale'
  | 'machine'
  | 'accessory';

export interface OwnedEquipment {
  id: string;
  /** Null for a custom entry — gear with no catalogue row. */
  equipment_model_id: string | null;
  slug: string | null;
  name: string;
  brand: string | null;
  category: EquipmentCategory;
  grind_scale_type: string | null;
  nickname: string | null;
  is_primary: boolean;
  /** Your own entry rather than a catalogue model. Private to you. */
  is_custom: boolean;
  created_at: string;
}

interface OwnedResponse {
  items: OwnedEquipment[];
}

/** Catalogue rows, as the public equipment endpoint returns them. */
export interface EquipmentOption {
  id: string;
  slug: string;
  name: string;
  category: EquipmentCategory;
  brand?: { name?: string } | null;
}

export const CATEGORY_LABEL: Record<EquipmentCategory, string> = {
  grinder: 'Grinders',
  brewer: 'Brewers',
  kettle: 'Kettles',
  scale: 'Scales',
  machine: 'Espresso machines',
  accessory: 'Other kit',
};

/** Brand + model, the way somebody would say it out loud. */
export function equipmentTitle(item: OwnedEquipment): string {
  return [item.brand, item.name].filter(Boolean).join(' ');
}

/**
 * Record gear the catalogue does not have. Private to the person adding it and
 * usable immediately — no review, no waiting.
 */
export async function addCustomEquipment(
  input: { brand?: string; name: string; category: EquipmentCategory; is_primary?: boolean },
  options?: ApiRequestOptions,
): Promise<OwnedEquipment[]> {
  const body = await apiFetch<OwnedResponse>(`${MY_EQUIPMENT_PATH}/custom`, {
    ...options,
    method: 'POST',
    body: input,
  });
  return body?.items ?? [];
}

export async function fetchMyEquipment(options?: ApiRequestOptions): Promise<OwnedEquipment[]> {
  const body = await apiFetch<OwnedResponse>(MY_EQUIPMENT_PATH, options);
  return body?.items ?? [];
}

export async function addMyEquipment(
  input: { equipment_model_id: string; nickname?: string; is_primary?: boolean },
  options?: ApiRequestOptions,
): Promise<OwnedEquipment[]> {
  const body = await apiFetch<OwnedResponse>(MY_EQUIPMENT_PATH, {
    ...options,
    method: 'POST',
    body: input,
  });
  return body?.items ?? [];
}

export async function makePrimaryEquipment(
  id: string,
  options?: ApiRequestOptions,
): Promise<OwnedEquipment[]> {
  const body = await apiFetch<OwnedResponse>(
    `${MY_EQUIPMENT_PATH}/${encodeURIComponent(id)}`,
    { ...options, method: 'PATCH' },
  );
  return body?.items ?? [];
}

export async function removeMyEquipment(
  id: string,
  options?: ApiRequestOptions,
): Promise<OwnedEquipment[]> {
  const body = await apiFetch<OwnedResponse>(
    `${MY_EQUIPMENT_PATH}/${encodeURIComponent(id)}`,
    { ...options, method: 'DELETE' },
  );
  return body?.items ?? [];
}

/** One row from the shared autocomplete endpoint. */
export interface EquipmentSuggestion {
  id: string;
  slug: string;
  label: string;
  /** The catalogue's own word for the category, e.g. "grinder". */
  sublabel: string | null;
}

/**
 * Search the catalogue.
 *
 * Uses the shared `/v1/autocomplete` endpoint filtered to equipment rather than
 * listing everything: at 98 models a dropdown is already a scrolling chore, and
 * the catalogue only grows. Searching server-side also means a match on brand
 * OR model works without shipping the whole list to every browser.
 *
 * The API rejects an all-whitespace query with a 400, so callers must not send
 * one — `searchEquipment` returns early instead of asking.
 */
export async function searchEquipment(
  query: string,
  options?: ApiRequestOptions,
): Promise<EquipmentSuggestion[]> {
  const q = query.trim();
  if (q === '') return [];
  const body = await apiFetch<{ items?: EquipmentSuggestion[] }>(
    `/api/v1/autocomplete?types=equipment&limit=8&q=${encodeURIComponent(q)}`,
    options,
  );
  return body?.items ?? [];
}

/* ------------------------------------------------------------------ *
 * Catalogue requests (tier 2) — proposals, not entries
 * ------------------------------------------------------------------ */

export const EQUIPMENT_REQUESTS_PATH = '/api/v1/equipment-requests';

export interface EquipmentRequest {
  id: string;
  submitted_text: string;
  image_storage_key: string | null;
  ai_draft: {
    brand?: string;
    name?: string;
    category?: string;
    grind_scale_type?: string;
    specs?: Record<string, unknown>;
    confidence?: string;
    notes?: string;
  } | null;
  ai_error: string | null;
  status: 'pending' | 'approved' | 'rejected';
  decision_note: string | null;
  created_at: string;
}

export async function fetchMyEquipmentRequests(
  options?: ApiRequestOptions,
): Promise<EquipmentRequest[]> {
  const body = await apiFetch<{ items?: EquipmentRequest[] }>(EQUIPMENT_REQUESTS_PATH, options);
  return body?.items ?? [];
}

/**
 * Propose something for the SHARED catalogue.
 *
 * Distinct from adding it to your own equipment, which is instant. This one
 * waits for a person, because the catalogue drives grind conversions and public
 * pages — and an assistant drafting from its own knowledge is occasionally
 * confidently wrong.
 */
export async function submitEquipmentRequest(
  input: { description: string; image_media_id?: string },
  options?: ApiRequestOptions,
): Promise<EquipmentRequest[]> {
  const body = await apiFetch<{ items?: EquipmentRequest[] }>(EQUIPMENT_REQUESTS_PATH, {
    ...options,
    method: 'POST',
    body: input,
  });
  return body?.items ?? [];
}
