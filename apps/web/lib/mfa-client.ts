/**
 * Two-factor (TOTP) client — the browser half of `POST /v1/auth/mfa/*`
 * (identity module, backlog ID-07).
 *
 * Everything goes through `lib/api.ts#apiFetch`, which owns credentials, the
 * single 401 → refresh → retry dance and the friendly-error mapping. This module
 * adds three things on top:
 *
 *  1. **CSRF.** Every MFA route sits behind `csrfGuard`, and the guard demands a
 *     double-submit token on any request carrying session cookies. `apiFetch`
 *     does not know about that (it is shared with unauthenticated endpoints), so
 *     the token is fetched from `GET /v1/auth/csrf` and echoed in `x-csrf-token`
 *     here. It is cached in a module variable, and a 403 buys exactly one
 *     refetch and one retry — never a loop.
 *  2. **Typed request/response shapes** for enrol / confirm / recovery-codes /
 *     disable, matching `apps/api/src/modules/identity/routes/mfa.ts`.
 *  3. **Redaction.** See below.
 *
 * ── Secret handling (non-negotiable) ─────────────────────────────────────────
 * The TOTP secret and the recovery codes are the account's second factor. In
 * this module and everything that consumes it they:
 *   - never touch localStorage, sessionStorage, IndexedDB, a cookie or a URL;
 *   - never reach `console.*` — the repo bans it outright (`no-console: error`),
 *     and `test/mfa-flow.test.tsx` re-asserts it with a spy because a lint rule
 *     does not cover a transitive dependency;
 *   - never appear in an error surfaced to the caller. `describeMfaError` is the
 *     only way a failure becomes a string, and it runs {@link redactSensitive}
 *     over the result, so a server that ever echoed a submitted code back in a
 *     validation message could not leak it into a UI string, a toast, or
 *     whatever error reporter this app grows later.
 * The recovery-code list lives in React state for exactly as long as the step is
 * on screen, and is dropped on acknowledgement.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import {
  ApiError,
  apiFetch,
  isApiError,
  type ApiRequestOptions,
} from './api';
import { normalizeActor, type AdminActor } from './admin-client';

const AUTH_BASE = '/api/v1/auth';

/**
 * The identity module mounts the self projection at `/v1/users/me`, so its
 * public path is this. `lib/api.ts#meApi` still points at `/api/me`, which the
 * dev rewrite resolves to `http://api/me` — a 404 (see FINAL REPORT; fixing it
 * means editing another lane's file). Rather than fork the wrapper, this module
 * asks for the route that exists and falls back to the legacy one, so the page
 * keeps working whichever way that gets settled.
 */
export const ME_PATH = '/api/v1/users/me';
export const LEGACY_ME_PATH = '/api/me';

/* ------------------------------------------------------------------ *
 * Redaction
 * ------------------------------------------------------------------ */

/** Base32 secrets (16+ chars) and any run of 6+ digits (TOTP / recovery code). */
const SECRET_SHAPED = /\b[A-Z2-7]{16,}={0,6}\b/g;
const CODE_SHAPED = /\b[0-9]{6,}\b/g;
/** Recovery codes are issued as grouped alphanumerics, e.g. `A1B2-C3D4-E5F6`. */
const GROUPED_CODE_SHAPED = /\b[A-Za-z0-9]{4,}(?:-[A-Za-z0-9]{4,}){1,}\b/g;

/**
 * Strip anything shaped like a secret or a one-time code out of free text.
 *
 * Deliberately blunt: a false positive costs a user one vague error message,
 * a false negative writes their second factor into a log line forever.
 */
export function redactSensitive(text: string): string {
  return text
    .replace(SECRET_SHAPED, '[redacted]')
    .replace(GROUPED_CODE_SHAPED, '[redacted]')
    .replace(CODE_SHAPED, '[redacted]');
}

/** The API's default 401 body — a session problem, not a credential problem. */
const GENERIC_401 = 'Authentication required';

/**
 * One line of copy for any MFA failure — the only supported way to turn an
 * error into something renderable. Never a stack, never a URL, never a payload.
 *
 * Prefers the API's own message on 400 and 401, because on these routes both
 * carry information the generic copy destroys. `POST /mfa/disable` answers a bad
 * password with `401 "Password is incorrect."`; `friendlyMessage` would map the
 * `unauthorized` code to "Please sign in again to continue.", sending somebody
 * off to re-authenticate over a typo. The one 401 that really is about the
 * session keeps the friendly wording, because the API leaves its message at the
 * default there.
 */
export function describeMfaError(error: unknown, fallback?: string): string {
  if (!isApiError(error)) {
    return fallback ?? 'Something went wrong on our side, not yours. Try again in a moment.';
  }
  const specific =
    error.message !== '' &&
    error.message !== GENERIC_401 &&
    (error.status === 400 || error.status === 401);
  return redactSensitive(specific ? error.message : error.userMessage);
}

/* ------------------------------------------------------------------ *
 * CSRF double-submit token
 * ------------------------------------------------------------------ */

let csrfToken: string | null = null;
let csrfHeaderName = 'x-csrf-token';

/** Test seam — drops the cached token. */
export function resetCsrfState(): void {
  csrfToken = null;
  csrfHeaderName = 'x-csrf-token';
}

async function csrfHeaders(options?: ApiRequestOptions): Promise<Record<string, string>> {
  if (csrfToken === null) {
    try {
      const body = await apiFetch<{ csrf_token?: string; header?: string }>(
        `${AUTH_BASE}/csrf`,
        { ...options, method: 'GET' },
      );
      if (typeof body?.csrf_token === 'string' && body.csrf_token !== '') {
        csrfToken = body.csrf_token;
      }
      if (typeof body?.header === 'string' && body.header !== '') {
        csrfHeaderName = body.header.toLowerCase();
      }
    } catch {
      // No token endpoint (or offline). Send the request anyway: the request's
      // own failure is the honest, actionable error — a synthetic "CSRF
      // unavailable" would just be noise the user cannot act on.
      return {};
    }
  }
  return csrfToken === null ? {} : { [csrfHeaderName]: csrfToken };
}

function withHeaders(options: ApiRequestOptions | undefined, extra: Record<string, string>) {
  const headers = new Headers(options?.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}

/** POST with a CSRF token, retrying once if the token was stale. */
async function postGuarded<T>(
  path: string,
  body: unknown,
  options?: ApiRequestOptions,
): Promise<T> {
  const send = async (): Promise<T> =>
    apiFetch<T>(path, {
      ...options,
      method: 'POST',
      body,
      headers: withHeaders(options, await csrfHeaders(options)),
    });

  try {
    return await send();
  } catch (error) {
    const staleToken = isApiError(error) && error.status === 403 && csrfToken !== null;
    if (!staleToken) throw error;
    csrfToken = null;
    return send();
  }
}

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

export type MfaFetch = <T>(path: string, options?: ApiRequestOptions) => Promise<T>;

/**
 * Enrolment + session standing for the signed-in user, or null when signed out.
 *
 * Reuses `normalizeActor` so this page and the operator console agree on what
 * "MFA-backed session" means. One caveat inherited from there: when `/me` omits
 * a session-level `mfa`, `mfaSession` falls back to `mfaEnrolled`. The live API
 * does send it (`routes/profile.ts`), and the fallback only ever *hides* the
 * "sign in again" advisory — it can never wrongly claim the session is
 * unverified, which is the direction that would matter.
 */
export async function fetchMfaStatus(
  fetcher: MfaFetch = apiFetch,
  options?: ApiRequestOptions,
): Promise<AdminActor | null> {
  try {
    return normalizeActor(await fetcher<unknown>(ME_PATH, options));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      try {
        return normalizeActor(await fetcher<unknown>(LEGACY_ME_PATH, options));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Enrolment + management
 * ------------------------------------------------------------------ */

export interface MfaEnrolment {
  /** Base32 TOTP secret. Render it, never store it. */
  secret: string;
  /** `otpauth://totp/...` — what the QR encodes. Also secret-bearing. */
  otpauthUrl: string;
  digits: number;
  periodSeconds: number;
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
const asNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** `POST /v1/auth/mfa/enrol` — stores an *unconfirmed* secret and returns it. */
export async function startEnrolment(options?: ApiRequestOptions): Promise<MfaEnrolment> {
  const body = await postGuarded<Record<string, unknown>>(
    `${AUTH_BASE}/mfa/enrol`,
    undefined,
    options,
  );
  return {
    secret: asString(body?.['secret']),
    otpauthUrl: asString(body?.['otpauth_url']),
    digits: asNumber(body?.['digits'], 6),
    periodSeconds: asNumber(body?.['period'], 30),
  };
}

function asCodes(body: unknown): string[] {
  const list = (body as Record<string, unknown> | null)?.['recovery_codes'];
  return Array.isArray(list) ? list.filter((c): c is string => typeof c === 'string') : [];
}

/**
 * `POST /v1/auth/mfa/confirm` — turns enrolment on and returns the recovery
 * codes. This response is the **only** copy of them that will ever exist; the
 * API stores them hashed.
 */
export async function confirmEnrolment(
  code: string,
  options?: ApiRequestOptions,
): Promise<string[]> {
  return asCodes(
    await postGuarded<unknown>(`${AUTH_BASE}/mfa/confirm`, { code }, options),
  );
}

/** `POST /v1/auth/mfa/recovery-codes` — replaces the set; needs a live code. */
export async function regenerateRecoveryCodes(
  code: string,
  options?: ApiRequestOptions,
): Promise<string[]> {
  return asCodes(
    await postGuarded<unknown>(`${AUTH_BASE}/mfa/recovery-codes`, { code }, options),
  );
}

/**
 * `POST /v1/auth/mfa/disable` — password **and** a live code. The API requires
 * both (a hijacked session alone must not be able to remove the account's own
 * defences), so the form asks for both up front rather than discovering it via
 * a round trip.
 */
export async function disableMfa(
  input: { password: string; code: string },
  options?: ApiRequestOptions,
): Promise<void> {
  await postGuarded<unknown>(`${AUTH_BASE}/mfa/disable`, input, options);
}

/**
 * `POST /v1/auth/logout` — revokes the current session family.
 *
 * Not `authApi.logout` from lib/api.ts, for two reasons: that helper posts to
 * `/api/auth/logout`, which resolves to a path the API does not serve (it mounts
 * identity under `/v1/auth`, see FINAL REPORT), and it sends no CSRF token, so
 * `csrfGuard` would refuse it anyway. This exists because the one fix for
 * "enrolled, but this session never answered a challenge" is a round trip
 * through sign-in, and offering that advice without a working button is how a
 * dead end gets rebuilt one screen further along.
 */
export async function signOut(options?: ApiRequestOptions): Promise<void> {
  await postGuarded<unknown>('/api/v1/auth/logout', undefined, options);
}

/* ------------------------------------------------------------------ *
 * Presentation helpers (pure — kept next to the transport they describe)
 * ------------------------------------------------------------------ */

/**
 * Break a base32 secret into space-separated groups of four.
 *
 * Not decoration: this is the manual-entry fallback for anyone who cannot scan
 * a QR code, and an unbroken 32-character string is genuinely hard to type
 * accurately. Authenticator apps ignore the spaces.
 */
export function groupSecret(secret: string, groupSize = 4): string {
  const clean = secret.replace(/\s+/g, '').toUpperCase();
  const groups = clean.match(new RegExp(`.{1,${groupSize}}`, 'g'));
  return groups ? groups.join(' ') : '';
}

/** Digits only, capped at six — what the confirm/disable fields accept. */
export function normalizeCodeInput(value: string): string {
  return value.replace(/\D+/g, '').slice(0, 6);
}

export function isCompleteCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

/** The plain-text file offered on the recovery-codes step. */
export function recoveryCodesFile(codes: readonly string[], handle: string): string {
  return [
    'BrewCult recovery codes',
    `Account: @${handle}`,
    '',
    'Each code works once, in place of your authenticator app.',
    'Keep them somewhere that is not the device with your authenticator on it.',
    'Generating a new set replaces every code below.',
    '',
    ...codes,
    '',
  ].join('\n');
}
