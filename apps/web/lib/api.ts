/**
 * Typed fetch wrapper for the BrewCult public API (EF §2.1 — one public API for
 * all clients; the web app is just another consumer).
 *
 * Contract:
 *  - Paths are always written in their **public** form, `/api/...`. In
 *    production Caddy `handle_path /api/*` strips the prefix before proxying to
 *    `api:4000` (deployment_guide §5.3); in dev a Next rewrite does the same, so
 *    the browser is always same-origin and cookies Just Work.
 *  - Auth is HttpOnly cookies (EF §2.3). **This module never reads, writes or
 *    logs a token** — it only ever sets `credentials: 'include'`.
 *  - A 401 on a non-auth endpoint triggers exactly one silent
 *    `POST /api/auth/refresh` and one retry. Never a loop.
 *  - API errors arrive as `{ error, message }` and are surfaced as
 *    human-readable text (see `friendlyMessage`).
 */

export const API_PREFIX = '/api';

/** The error envelope every BrewCult API error uses. */
export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}

/** Thrown for any non-2xx API response. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  /** Copy safe to render straight into the UI. */
  readonly userMessage: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || body.error || `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error || 'unknown_error';
    this.details = body.details;
    this.userMessage = friendlyMessage(this.code, status, body.message);
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/**
 * Anti-gatekeeping copy (second_draft §9.7/§10.2): errors explain and offer the
 * next step; they never scold and never blame the person.
 */
const FRIENDLY_BY_CODE: Record<string, string> = {
  unauthorized: 'Please sign in again to continue.',
  forbidden: "You don't have access to that.",
  not_found: "We couldn't find that.",
  conflict: 'That already exists — try signing in instead.',
  rate_limited: 'That was a lot of tries in a row. Give it a minute and go again.',
  invalid_credentials: "That email and password didn't match. Try again, or reset your password.",
  email_not_verified: 'Almost there — confirm your email address first. We can resend the link.',
  invalid_token: 'That link has expired or was already used. Request a fresh one.',
  network_error:
    "We couldn't reach BrewCult. Check your connection — nothing you typed was lost.",
};

const FRIENDLY_BY_STATUS: Record<number, string> = {
  400: 'Something in the form needs a tweak.',
  401: 'Please sign in again to continue.',
  403: "You don't have access to that.",
  404: "We couldn't find that.",
  408: 'That took too long. Try again?',
  429: 'That was a lot of tries in a row. Give it a minute and go again.',
  500: 'Something broke on our side, not yours. Try again in a moment.',
  502: 'Something broke on our side, not yours. Try again in a moment.',
  503: 'BrewCult is catching its breath. Try again in a moment.',
};

/** Turn an API error code/status into copy a person can act on. */
export function friendlyMessage(code: string, status: number, serverMessage?: string): string {
  const byCode = FRIENDLY_BY_CODE[code];
  if (byCode) return byCode;
  if (status === 400 && serverMessage) return serverMessage;
  return (
    FRIENDLY_BY_STATUS[status] ??
    serverMessage ??
    'Something went wrong. Try again in a moment.'
  );
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  /** Plain object → JSON body. Strings / FormData pass through untouched. */
  body?: unknown;
  /**
   * Attempt one silent refresh + retry on 401. Defaults to true in the browser,
   * false on the server (an RSC render cannot write refreshed cookies back).
   */
  refreshOn401?: boolean;
  /** Injected in tests. */
  fetchImpl?: FetchLike;
  /** Origin override; '' means same-origin. */
  baseUrl?: string;
}

const isBrowser = (): boolean => typeof window !== 'undefined';

/** Endpoints where a 401 is the *answer*, not a stale-token symptom. */
const NO_REFRESH_PATHS = [
  '/api/v1/auth/refresh',
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/logout',
  '/api/v1/auth/verify-email',
  '/api/v1/auth/password-reset',
];

export function shouldAttemptRefresh(path: string): boolean {
  return !NO_REFRESH_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Map a public `/api/...` path onto a real URL.
 * Browser → same-origin (Caddy / dev rewrite strips `/api`).
 * Server   → the internal API origin, with `/api` stripped to match.
 */
export function resolveApiUrl(path: string, baseUrl?: string): string {
  if (!path.startsWith(`${API_PREFIX}/`)) {
    throw new Error(`API paths must start with "${API_PREFIX}/": ${path}`);
  }
  const base =
    baseUrl ??
    (isBrowser() ? '' : (process.env.API_INTERNAL_URL ?? 'http://localhost:4000'));
  if (base === '') return path;
  return `${base.replace(/\/+$/, '')}${path.slice(API_PREFIX.length)}`;
}

/** In-flight refresh, so five parallel 401s cause one refresh, not five. */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(doFetch: FetchLike, baseUrl?: string): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await doFetch(resolveApiUrl('/api/v1/auth/refresh', baseUrl), {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      // Cleared on the next microtask so callers awaiting this one share it.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();
  return refreshInFlight;
}

/** Test seam — drops any memoised refresh attempt. */
export function resetRefreshState(): void {
  refreshInFlight = null;
  csrfToken = null;
}

/**
 * CSRF double-submit token. Cookie-authenticated mutations are rejected by the
 * API's csrfGuard unless the token from `GET /v1/auth/csrf` is echoed in
 * `x-csrf-token`. Handled here rather than per-caller so no future mutation can
 * forget it (every caller that did forget got a silent 403).
 */
let csrfToken: string | null = null;

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function fetchCsrfToken(doFetch: FetchLike, baseUrl?: string): Promise<string | null> {
  try {
    const res = await doFetch(resolveApiUrl('/api/v1/auth/csrf', baseUrl), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const token =
      body && typeof body === 'object'
        ? ((body as Record<string, unknown>)['csrf_token'] ??
           (body as Record<string, unknown>)['token'])
        : null;
    return typeof token === 'string' ? token : null;
  } catch {
    return null;
  }
}

async function readErrorBody(res: Response): Promise<ApiErrorBody> {
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === 'object') {
      const candidate = parsed as Partial<ApiErrorBody>;
      return {
        error: typeof candidate.error === 'string' ? candidate.error : 'unknown_error',
        message: typeof candidate.message === 'string' ? candidate.message : '',
        ...(candidate.details !== undefined ? { details: candidate.details } : {}),
      };
    }
  } catch {
    /* non-JSON error body (proxy/HTML) — fall through to the generic shape */
  }
  return { error: 'unknown_error', message: '' };
}

/**
 * Perform an API request. Resolves with the parsed JSON body (`undefined` for
 * 204), or throws {@link ApiError}.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const {
    body,
    refreshOn401 = isBrowser(),
    fetchImpl,
    baseUrl,
    headers,
    ...rest
  } = options;

  const doFetch: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));
  const url = resolveApiUrl(path, baseUrl);

  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has('Accept')) requestHeaders.set('Accept', 'application/json');

  let payload: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (typeof body === 'string' || body instanceof FormData) {
      payload = body;
    } else {
      payload = JSON.stringify(body);
      if (!requestHeaders.has('Content-Type')) {
        requestHeaders.set('Content-Type', 'application/json');
      }
    }
  }

  // CSRF is lazy on purpose: the API only demands a double-submit token on
  // requests that carry session cookies (login and friends are covered by its
  // Origin allow-list instead). Sending a preflight on every mutation would add
  // a round trip to flows that never need one, so we attach a cached token when
  // we already have one and otherwise mint one only if the API says 403.
  const method = (rest.method ?? 'GET').toUpperCase();
  const mayNeedCsrf = MUTATING_METHODS.has(method) && !requestHeaders.has('x-csrf-token');
  if (mayNeedCsrf && csrfToken) requestHeaders.set('x-csrf-token', csrfToken);

  const init: RequestInit = {
    ...rest,
    credentials: 'include',
    headers: requestHeaders,
    ...(payload !== undefined ? { body: payload } : {}),
  };

  let res: Response;
  try {
    res = await doFetch(url, init);
  } catch {
    // Offline / DNS / TLS. Deliberately swallows the cause: it can contain the
    // full request URL, and nothing about a failed socket helps the user.
    throw new ApiError(0, { error: 'network_error', message: '' });
  }

  // A missing, rotated or expired token reads as 403. Mint one and retry ONCE,
  // and only when the failure actually looks like CSRF, so an ordinary
  // permission denial (staff routes without MFA) is never retried.
  //
  // The body is parsed here rather than from a clone: a Response body is a
  // single-use stream, and reading it twice left the error path with nothing
  // (which silently swallowed the mfa_required message the console shows).
  let prereadError: ApiErrorBody | null = null;
  if (res.status === 403 && mayNeedCsrf) {
    prereadError = await readErrorBody(res);
    const looksLikeCsrf = JSON.stringify(prereadError).toLowerCase().includes('csrf');
    if (looksLikeCsrf) {
      const fresh = await fetchCsrfToken(doFetch, baseUrl);
      if (fresh) {
        csrfToken = fresh;
        requestHeaders.set('x-csrf-token', fresh);
        prereadError = null;
        try {
          res = await doFetch(url, { ...init, headers: requestHeaders });
        } catch {
          throw new ApiError(0, { error: 'network_error', message: '' });
        }
      }
    }
  }

  if (res.status === 401 && refreshOn401 && shouldAttemptRefresh(path)) {
    const refreshed = await refreshSession(doFetch, baseUrl);
    if (refreshed) {
      try {
        res = await doFetch(url, init);
      } catch {
        throw new ApiError(0, { error: 'network_error', message: '' });
      }
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, prereadError ?? (await readErrorBody(res)));
  }

  if (res.status === 204) return undefined as T;

  try {
    return (await res.json()) as T;
  } catch {
    return undefined as T;
  }
}

/* ------------------------------------------------------------------ *
 * Endpoint shapes (assumed contract with Lane E/F — see FINAL REPORT)
 * ------------------------------------------------------------------ */

export interface SessionUser {
  id: string;
  handle: string;
  email: string;
  displayName: string | null;
  emailVerified?: boolean;
  avatarUrl?: string | null;
}

export interface CoffeeSummary {
  id: string;
  slug: string;
  name: string;
  /** The API returns snake_case with nested refs (see the catalog module's
   *  types.ts). These used to be camelCase here, which silently rendered blank
   *  metadata on /discover — every field read as undefined. */
  roaster?: { id: string; slug: string; name: string } | null;
  origin?: { id?: string; country?: string; region?: string | null } | null;
  process?: string | null;
  roast_level?: string | null;
  intended_use?: string | null;
  tasting_notes?: string[];
}

export interface Paginated<T> {
  items: T[];
  next_cursor?: string | null;
}

export interface AutocompleteSuggestion {
  id: string;
  type: 'coffee' | 'roaster' | 'equipment' | string;
  label: string;
  slug?: string;
  subtitle?: string | null;
}

export const authApi = {
  register: (
    input: { email: string; password: string; handle: string; displayName?: string },
    options?: ApiRequestOptions,
  ) => apiFetch<{ user?: SessionUser }>('/api/v1/auth/register', { ...options, method: 'POST', body: input }),

  /**
   * Answers either a session or an MFA challenge — the same two-leg shape
   * Zentra uses. Callers check `mfa_required` and follow up with `mfaVerify`.
   */
  login: (input: { email: string; password: string }, options?: ApiRequestOptions) =>
    apiFetch<{ user?: SessionUser; mfa_required?: boolean; mfa_token?: string }>(
      '/api/v1/auth/login',
      { ...options, method: 'POST', body: input },
    ),

  /** Leg two of the MFA login: a TOTP code, or a recovery code as the escape hatch. */
  mfaVerify: (
    input: { mfa_token: string; code?: string; recovery_code?: string },
    options?: ApiRequestOptions,
  ) =>
    apiFetch<{ user?: SessionUser }>('/api/v1/auth/mfa/verify', {
      ...options,
      method: 'POST',
      body: input,
    }),

  logout: (options?: ApiRequestOptions) =>
    apiFetch<void>('/api/v1/auth/logout', { ...options, method: 'POST' }),

  verifyEmail: (input: { token: string }, options?: ApiRequestOptions) =>
    apiFetch<void>('/api/v1/auth/verify-email', { ...options, method: 'POST', body: input }),

  requestPasswordReset: (input: { email: string }, options?: ApiRequestOptions) =>
    apiFetch<void>('/api/v1/auth/password-reset/request', {
      ...options,
      method: 'POST',
      body: input,
    }),

  confirmPasswordReset: (
    input: { token: string; password: string },
    options?: ApiRequestOptions,
  ) =>
    apiFetch<void>('/api/v1/auth/password-reset/confirm', {
      ...options,
      method: 'POST',
      body: input,
    }),
} as const;

/** Redirect start for Google OAuth — a plain link, never an XHR. */
export const GOOGLE_OAUTH_START = '/api/v1/auth/google';

export const catalogApi = {
  coffees: (options?: ApiRequestOptions) =>
    apiFetch<Paginated<CoffeeSummary>>('/api/v1/coffees', options),

  coffee: (slug: string, options?: ApiRequestOptions) =>
    apiFetch<CoffeeSummary>(`/api/v1/coffees/${encodeURIComponent(slug)}`, options),

  autocomplete: (query: string, types: string[] = [], options?: ApiRequestOptions) => {
    const params = new URLSearchParams({ q: query });
    if (types.length > 0) params.set('types', types.join(','));
    return apiFetch<{ results: AutocompleteSuggestion[] }>(
      `/api/v1/autocomplete?${params.toString()}`,
      options,
    );
  },
} as const;

export const meApi = {
  get: (options?: ApiRequestOptions) => apiFetch<SessionUser>('/api/v1/users/me', options),
} as const;
