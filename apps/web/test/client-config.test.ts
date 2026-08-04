import { describe, expect, it, vi } from 'vitest';
import {
  CLIENT_CONFIG_FALLBACK_PATH,
  CLIENT_CONFIG_PATH,
  DEFAULT_FEATURE_FLAGS,
  FALLBACK_CLIENT_CONFIG,
  fetchClientConfig,
  isClientOutdated,
  isVersionBelow,
  normalizeClientConfig,
} from '../lib/client-config';

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('client-config fallback', () => {
  it('falls back when the API is unreachable — the app still renders', async () => {
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValue(new Error('connection refused'));

    const config = await fetchClientConfig({ fetchImpl, baseUrl: '' });

    expect(config).toEqual(FALLBACK_CLIENT_CONFIG);
    expect(config.source).toBe('fallback');
  });

  it('falls back on a 500', async () => {
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(jsonResponse(500, { error: 'internal', message: 'boom' }));

    await expect(fetchClientConfig({ fetchImpl, baseUrl: '' })).resolves.toEqual(
      FALLBACK_CLIENT_CONFIG,
    );
  });

  it('falls back on a malformed body rather than throwing', async () => {
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response('not json at all', { status: 200 }));

    const config = await fetchClientConfig({ fetchImpl, baseUrl: '' });
    expect(config.features).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it('tries the unversioned path once when the versioned one 404s', async () => {
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse(404, { error: 'not_found', message: '' }))
      .mockResolvedValueOnce(
        jsonResponse(200, { minSupportedVersion: '0.2.0', features: { navNews: true } }),
      );

    const config = await fetchClientConfig({ fetchImpl, baseUrl: '' });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(CLIENT_CONFIG_PATH);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(CLIENT_CONFIG_FALLBACK_PATH);
    expect(config.features.navNews).toBe(true);
    expect(config.minSupportedVersion).toBe('0.2.0');
  });

  it('reads real flags when the API answers', async () => {
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        jsonResponse(200, {
          minSupportedVersion: '0.1.0',
          features: { navBrew: true, googleAuth: false },
        }),
      );

    const config = await fetchClientConfig({ fetchImpl, baseUrl: '' });

    expect(config.source).toBe('api');
    expect(config.features.navBrew).toBe(true);
    expect(config.features.googleAuth).toBe(false);
    // Unmentioned flags keep their Phase-1 default.
    expect(config.features.navMarketplace).toBe(false);
    expect(config.features.entitySearch).toBe(true);
  });
});

describe('normalizeClientConfig', () => {
  it('accepts `flags` as an alias for `features`', () => {
    const config = normalizeClientConfig({ flags: { navAi: true } });
    expect(config.features.navAi).toBe(true);
  });

  it('ignores non-boolean flag values instead of coercing them', () => {
    const config = normalizeClientConfig({ features: { navAi: 'yes', navNews: 1 } });
    expect(config.features.navAi).toBe(false);
    expect(config.features.navNews).toBe(false);
  });

  it('ignores unknown keys', () => {
    const config = normalizeClientConfig({ features: { somethingNew: true } });
    expect(Object.keys(config.features).sort()).toEqual(
      Object.keys(DEFAULT_FEATURE_FLAGS).sort(),
    );
  });
});

describe('minimum supported version', () => {
  it('compares versions numerically', () => {
    expect(isVersionBelow('0.1.0', '0.2.0')).toBe(true);
    expect(isVersionBelow('1.0.0', '0.9.9')).toBe(false);
    expect(isVersionBelow('0.1.0', '0.1.0')).toBe(false);
    expect(isVersionBelow('junk', '0.0.1')).toBe(true);
  });

  it('treats the fallback config as current', () => {
    expect(isClientOutdated(FALLBACK_CLIENT_CONFIG)).toBe(false);
  });
});
