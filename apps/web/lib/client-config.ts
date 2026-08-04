/**
 * Client config + feature flags (EF §2.5).
 *
 * `GET /v1/client-config` carries min supported version, feature flags and kill
 * switches. It exists from Phase 1 specifically so the *web* app exercises it
 * before iOS depends on it — which means the web app must degrade gracefully
 * when it is missing, slow or wrong. Hence: this module never throws, and
 * always resolves to a complete, typed config.
 *
 * Flags gate the navigation (second_draft §27) and the Google button.
 */
import { ApiError, apiFetch, type ApiRequestOptions } from './api';

export interface FeatureFlags {
  /** Nav surfaces from second_draft §27 that arrive after Phase 1. */
  navBrew: boolean;
  navAi: boolean;
  navNews: boolean;
  navCommunity: boolean;
  navMarketplace: boolean;
  /** "Continue with Google" (deployment_guide §7.2). */
  googleAuth: boolean;
  /** Entity autocomplete on Discover. */
  entitySearch: boolean;
  /** Data-subject rights endpoints (EF §4.3) — UI copes if they 404. */
  accountExport: boolean;
  accountDeletion: boolean;
}

export interface ClientConfig {
  /** Lowest client version the API still serves (EF §2.5). */
  minSupportedVersion: string;
  features: FeatureFlags;
  /** Whether this came from the API or the offline fallback. */
  source: 'api' | 'fallback';
}

/** This build's client version — reported against `minSupportedVersion`. */
export const WEB_CLIENT_VERSION = '0.1.0';

/**
 * Phase-1 defaults. Everything §27 hasn't shipped yet is off; everything that
 * exists is on, so a dead config endpoint degrades to "the app we shipped",
 * not "a blank app".
 */
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  navBrew: false,
  navAi: false,
  navNews: false,
  navCommunity: false,
  navMarketplace: false,
  googleAuth: true,
  entitySearch: true,
  accountExport: true,
  accountDeletion: true,
};

export const FALLBACK_CLIENT_CONFIG: ClientConfig = {
  minSupportedVersion: '0.0.0',
  features: DEFAULT_FEATURE_FLAGS,
  source: 'fallback',
};

/**
 * EF §2.5 names the endpoint `/v1/client-config`; it is served publicly at
 * `/api/v1/client-config`. Older/interim API builds exposed it unversioned, so
 * a 404 on the versioned path falls back once before giving up.
 */
export const CLIENT_CONFIG_PATH = '/api/v1/client-config';
export const CLIENT_CONFIG_FALLBACK_PATH = '/api/client-config';

/** Accepts either `features` or `flags` as the map key. */
export function normalizeClientConfig(raw: unknown): ClientConfig {
  if (!raw || typeof raw !== 'object') return FALLBACK_CLIENT_CONFIG;

  const record = raw as Record<string, unknown>;
  const rawFlags =
    (record['features'] as Record<string, unknown> | undefined) ??
    (record['flags'] as Record<string, unknown> | undefined) ??
    {};

  const features: FeatureFlags = { ...DEFAULT_FEATURE_FLAGS };
  for (const key of Object.keys(DEFAULT_FEATURE_FLAGS) as (keyof FeatureFlags)[]) {
    const value = rawFlags[key];
    if (typeof value === 'boolean') features[key] = value;
  }

  const minSupportedVersion =
    typeof record['minSupportedVersion'] === 'string'
      ? record['minSupportedVersion']
      : typeof record['minVersion'] === 'string'
        ? record['minVersion']
        : FALLBACK_CLIENT_CONFIG.minSupportedVersion;

  return { minSupportedVersion, features, source: 'api' };
}

/**
 * Fetch the client config. Resolves with {@link FALLBACK_CLIENT_CONFIG} for any
 * failure — network, 5xx, 404, malformed body. It must never be the reason a
 * page fails to render.
 */
export async function fetchClientConfig(options?: ApiRequestOptions): Promise<ClientConfig> {
  const request = (path: string) =>
    apiFetch<unknown>(path, {
      // Short cache: a kill switch should take effect in a minute, not a deploy.
      next: { revalidate: 60 },
      refreshOn401: false,
      ...options,
    });

  try {
    return normalizeClientConfig(await request(CLIENT_CONFIG_PATH));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      try {
        return normalizeClientConfig(await request(CLIENT_CONFIG_FALLBACK_PATH));
      } catch {
        return FALLBACK_CLIENT_CONFIG;
      }
    }
    return FALLBACK_CLIENT_CONFIG;
  }
}

/** `a < b` semver-ish compare, tolerant of junk. */
export function isVersionBelow(version: string, minimum: string): boolean {
  const parse = (v: string) =>
    v
      .split('.')
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parse(version), parse(minimum)];
  for (let i = 0; i < 3; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left < right;
  }
  return false;
}

/** True when this build is older than the API's floor (EF §2.5). */
export function isClientOutdated(config: ClientConfig): boolean {
  return isVersionBelow(WEB_CLIENT_VERSION, config.minSupportedVersion);
}
