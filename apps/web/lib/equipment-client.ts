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
  equipment_model_id: string;
  slug: string;
  name: string;
  brand: string;
  category: EquipmentCategory;
  grind_scale_type: string | null;
  nickname: string | null;
  is_primary: boolean;
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

/**
 * The catalogue, for the picker.
 *
 * `limit=100` because the API caps it there and answers 400 above — the same
 * trap that left the sitemap silently empty (§9.3). One page is plenty for the
 * current catalogue; when it outgrows that this becomes a search box.
 */
export async function fetchEquipmentOptions(
  options?: ApiRequestOptions,
): Promise<EquipmentOption[]> {
  const body = await apiFetch<{ items?: EquipmentOption[] }>(
    '/api/v1/equipment?limit=100',
    options,
  );
  return body?.items ?? [];
}
