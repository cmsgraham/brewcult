import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiFetch,
  friendlyMessage,
  isApiError,
  resetRefreshState,
  resolveApiUrl,
  shouldAttemptRefresh,
} from '../lib/api';

/** Minimal Response stand-in — no live server, no node-fetch. */
function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const BASE = '';

beforeEach(() => {
  resetRefreshState();
});

describe('resolveApiUrl', () => {
  it('keeps public /api paths same-origin in the browser', () => {
    expect(resolveApiUrl('/api/v1/coffees', '')).toBe('/api/v1/coffees');
  });

  it('strips the /api prefix when talking to the API origin directly', () => {
    // Caddy `handle_path /api/*` does the same in production.
    expect(resolveApiUrl('/api/v1/coffees', 'http://api:4000')).toBe(
      'http://api:4000/v1/coffees',
    );
    expect(resolveApiUrl('/api/v1/auth/login', 'http://localhost:4000/')).toBe(
      'http://localhost:4000/v1/auth/login',
    );
  });

  it('refuses paths that are not in public form', () => {
    expect(() => resolveApiUrl('/v1/coffees', '')).toThrow(/must start with/);
  });
});

describe('401 → silent refresh → retry', () => {
  it('refreshes once and retries the original request', async () => {
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized', message: 'nope' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true })) // the refresh
      .mockResolvedValueOnce(jsonResponse(200, { id: 'u_1', handle: 'nadia' }));

    const result = await apiFetch<{ handle: string }>('/api/v1/users/me', {
      fetchImpl,
      baseUrl: BASE,
      refreshOn401: true,
    });

    expect(result.handle).toBe('nadia');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('/api/v1/auth/refresh');
    expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe('POST');
    // Original request replayed unchanged.
    expect(fetchImpl.mock.calls[2]?.[0]).toBe('/api/v1/users/me');
  });

  it('gives up after one refresh — never loops', async () => {
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized', message: '' }))
      .mockResolvedValueOnce(jsonResponse(200, {})) // refresh succeeds
      .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized', message: '' }));

    await expect(
      apiFetch('/api/v1/users/me', { fetchImpl, baseUrl: BASE, refreshOn401: true }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry when the refresh itself fails', async () => {
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized', message: '' }))
      .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized', message: '' }));

    await expect(
      apiFetch('/api/v1/users/me', { fetchImpl, baseUrl: BASE, refreshOn401: true }),
    ).rejects.toMatchObject({ status: 401 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('never refreshes for auth endpoints — a 401 from /login is the answer', async () => {
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        jsonResponse(401, { error: 'invalid_credentials', message: 'bad password' }),
      );

    await expect(
      apiFetch('/api/v1/auth/login', {
        method: 'POST',
        body: { email: 'a@b.co', password: 'x' },
        fetchImpl,
        baseUrl: BASE,
        refreshOn401: true,
      }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('leaves the 401 alone when refreshOn401 is off (server rendering)', async () => {
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(jsonResponse(401, { error: 'unauthorized', message: '' }));

    await expect(
      apiFetch('/api/v1/users/me', { fetchImpl, baseUrl: BASE, refreshOn401: false }),
    ).rejects.toMatchObject({ status: 401 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('shares one refresh between parallel 401s', async () => {
    const seen = new Map<string, number>();
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockImplementation((input: string) => {
        if (input === '/api/v1/auth/refresh') return Promise.resolve(jsonResponse(200, {}));
        const attempt = (seen.get(input) ?? 0) + 1;
        seen.set(input, attempt);
        return Promise.resolve(
          attempt === 1
            ? jsonResponse(401, { error: 'unauthorized', message: '' })
            : jsonResponse(200, { ok: true }),
        );
      });

    await Promise.all([
      apiFetch('/api/v1/users/me', { fetchImpl, baseUrl: BASE, refreshOn401: true }),
      apiFetch('/api/v1/coffees', { fetchImpl, baseUrl: BASE, refreshOn401: true }),
    ]);

    const refreshCalls = fetchImpl.mock.calls.filter(
      (call) => call[0] === '/api/v1/auth/refresh',
    );
    expect(refreshCalls).toHaveLength(1);
  });
});

describe('request shaping', () => {
  it('always sends credentials and JSON-encodes object bodies', async () => {
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(jsonResponse(200, {}));

    await apiFetch('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'nadia@example.com', password: 'a-very-long-password' },
      fetchImpl,
      baseUrl: BASE,
    });

    const loginCall = fetchImpl.mock.calls.find((call) =>
      String(call[0]).includes('/v1/auth/login'),
    );
    const init = loginCall?.[1];
    expect(init?.credentials).toBe('include');
    expect(init?.body).toBe(
      JSON.stringify({ email: 'nadia@example.com', password: 'a-very-long-password' }),
    );
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  });

  it('returns undefined for 204 rather than exploding on an empty body', async () => {
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      apiFetch('/api/v1/auth/logout', { method: 'POST', fetchImpl, baseUrl: BASE }),
    ).resolves.toBeUndefined();
  });

  it('turns a network failure into a friendly ApiError without leaking the cause', async () => {
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.internal'));

    const error = await apiFetch('/api/v1/users/me', { fetchImpl, baseUrl: BASE }).catch(
      (caught: unknown) => caught,
    );

    expect(isApiError(error)).toBe(true);
    expect((error as ApiError).code).toBe('network_error');
    expect((error as ApiError).userMessage).toContain("couldn't reach BrewCult");
    expect(JSON.stringify(error)).not.toContain('ENOTFOUND');
  });

  it('survives a non-JSON error body from a proxy', async () => {
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response('<html>502</html>', { status: 502 }));

    await expect(
      apiFetch('/api/v1/coffees', { fetchImpl, baseUrl: BASE }),
    ).rejects.toMatchObject({ status: 502, code: 'unknown_error' });
  });
});

describe('error copy', () => {
  it('never scolds the person', () => {
    expect(friendlyMessage('rate_limited', 429)).toMatch(/give it a minute/i);
    expect(friendlyMessage('unknown', 500)).toMatch(/our side, not yours/i);
    expect(friendlyMessage('invalid_credentials', 401)).toMatch(/reset your password/i);
  });
});

describe('shouldAttemptRefresh', () => {
  it('excludes every auth endpoint and nothing else', () => {
    expect(shouldAttemptRefresh('/api/v1/auth/refresh')).toBe(false);
    // The real reset endpoints. This asserted `/password-reset/confirm`, an
    // invented path that 404s — so "forgot your password" never worked and the
    // test agreed with the client rather than with the API. Found by the
    // web→api contract check on its first run.
    expect(shouldAttemptRefresh('/api/v1/auth/password/forgot')).toBe(false);
    expect(shouldAttemptRefresh('/api/v1/auth/password/reset')).toBe(false);
    expect(shouldAttemptRefresh('/api/v1/users/me')).toBe(true);
    expect(shouldAttemptRefresh('/api/v1/coffees')).toBe(true);
  });
});
