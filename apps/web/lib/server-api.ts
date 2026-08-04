/**
 * Server-side (RSC / route handler) API access.
 *
 * Separate from lib/api.ts because it imports `next/headers`, which must never
 * reach a client bundle. Two differences from the browser path:
 *
 *  1. Cookies are forwarded explicitly — an RSC `fetch` carries no cookie jar.
 *  2. No silent-refresh retry: a server render cannot write a rotated refresh
 *     cookie back to the browser, so a 401 here means "send them to /login" and
 *     the *browser* does the refresh dance on its next call.
 */
import 'server-only';
import { cookies } from 'next/headers';
import { ApiError, apiFetch, type ApiRequestOptions, type SessionUser } from './api';

export async function serverApiFetch<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const headers = new Headers(options.headers);
  if (cookieHeader && !headers.has('cookie')) headers.set('cookie', cookieHeader);

  return apiFetch<T>(path, {
    ...options,
    headers,
    refreshOn401: false,
    // Authenticated reads are per-request; catalog callers opt back in to caching.
    cache: options.cache ?? 'no-store',
  });
}

/**
 * The signed-in user, or null. Never throws — an unauthenticated visitor is a
 * normal state, not an error.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    return await serverApiFetch<SessionUser>('/api/me');
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return null;
    }
    // API down / not built yet: treat as signed-out rather than 500 the page.
    return null;
  }
}
