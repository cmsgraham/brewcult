/**
 * Google sign-in — DG §7.2, backlog ID-05.
 *
 * Authorization-code flow with PKCE via @fastify/oauth2 (the same shape iOS will
 * use later, EF §2.3). Registration is conditional: with no GOOGLE_CLIENT_ID the
 * plugin is not registered at all and the app still boots — the web client hides
 * the button (DG §7.2 item 4).
 *
 * The security-relevant part is `resolveGoogleIdentity`, which is a plain
 * database function precisely so it can be tested without an OAuth dance.
 */
// Named import (not default): only the namespace export carries the
// `*_CONFIGURATION` provider presets in the published typings.
import { fastifyOauth2, type OAuth2Namespace } from '@fastify/oauth2';
import type { FastifyInstance } from 'fastify';
import { getEnv, isProduction } from '../../lib/env.js';
import { recordAuditEvent } from './audit.js';
import { recordLoginAttempt } from './login-attempts.js';
import {
  createUser,
  findAuthIdentity,
  findUserByEmail,
  findUserById,
  handleExists,
  linkAuthIdentity,
} from './repo.js';
import { normaliseEmail } from './secrets.js';
import type { Exec, GoogleProfile, UserRow } from './types.js';

declare module 'fastify' {
  interface FastifyInstance {
    googleOAuth2?: OAuth2Namespace;
  }
}

export const GOOGLE_START_PATH = '/auth/google';
/** Must byte-match a redirect URI registered in the Google console (DG §7.2). */
export const GOOGLE_CALLBACK_PATH = '/auth/google/callback';

const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export type GoogleLinkOutcome =
  | { kind: 'existing_identity'; user: UserRow }
  | { kind: 'linked'; user: UserRow }
  | { kind: 'created'; user: UserRow }
  | { kind: 'refused'; reason: 'provider_email_unverified' | 'no_email' };

/**
 * Turns a Google profile into a BrewCult user.
 *
 * THE HARD GATE (DG §7.2 item 2): an existing account is linked ONLY when
 * Google reports `email_verified === true`. Anything else — false, absent, or a
 * non-boolean — refuses. Linking on an unverified provider email is a direct
 * account-takeover path: anyone who can create a Google account claiming
 * victim@example.com would inherit the BrewCult account.
 *
 * We go one step further than the doc and refuse to *create* an account from an
 * unverified provider email too, otherwise an attacker can squat an address
 * they do not control and block the real owner from registering.
 */
export async function resolveGoogleIdentity(
  exec: Exec,
  profile: GoogleProfile,
  context: { ip?: string | null; userAgent?: string | null } = {},
): Promise<GoogleLinkOutcome> {
  // 1. Already linked → this is simply a returning user. No email involved, so
  //    the verification gate does not apply.
  const identity = await findAuthIdentity(exec, 'google', profile.sub);
  if (identity) {
    const user = await findUserById(exec, identity.user_id);
    if (user) return { kind: 'existing_identity', user };
  }

  const email = profile.email ? normaliseEmail(profile.email) : null;
  if (!email) {
    await recordLoginAttempt(exec, {
      email: null,
      success: false,
      provider: 'google',
      failureReason: 'provider_denied',
      ip: context.ip,
      userAgent: context.userAgent,
    });
    return { kind: 'refused', reason: 'no_email' };
  }

  if (profile.email_verified !== true) {
    await recordLoginAttempt(exec, {
      email,
      success: false,
      provider: 'google',
      failureReason: 'provider_email_unverified',
      ip: context.ip,
      userAgent: context.userAgent,
    });
    await recordAuditEvent(exec, {
      actorId: null,
      action: 'auth.identity_link_refused',
      targetType: 'auth_identity',
      targetId: `google:${profile.sub}`,
      payload: { reason: 'provider_email_unverified', email },
    });
    return { kind: 'refused', reason: 'provider_email_unverified' };
  }

  // 2. Verified provider email matching an existing account → link.
  const existing = await findUserByEmail(exec, email);
  if (existing) {
    await linkAuthIdentity(exec, {
      userId: existing.id,
      provider: 'google',
      providerSub: profile.sub,
      emailAtLinkTime: email,
    });
    await recordAuditEvent(exec, {
      actorId: existing.id,
      action: 'auth.identity_linked',
      targetType: 'user',
      targetId: existing.id,
      payload: { provider: 'google', email_verified: true },
    });
    return { kind: 'linked', user: existing };
  }

  // 3. No account yet → create one with NO password_hash (OAuth-only account,
  //    0002_identity.sql allows password_hash IS NULL for exactly this case).
  const handle = await allocateHandle(exec, email, profile.name);
  const user = await createUser(exec, {
    email,
    handle,
    passwordHash: null,
    displayName: profile.name ?? null,
    emailVerified: true, // Google asserted it, and we checked the assertion
  });
  await linkAuthIdentity(exec, {
    userId: user.id,
    provider: 'google',
    providerSub: profile.sub,
    emailAtLinkTime: email,
  });
  await recordAuditEvent(exec, {
    actorId: user.id,
    action: 'user.registered',
    targetType: 'user',
    targetId: user.id,
    payload: { provider: 'google' },
  });
  return { kind: 'created', user };
}

/**
 * Derives a free handle from the provider's data. Never reuses the email local
 * part verbatim if that would leak a taken handle's existence — it just keeps
 * appending entropy until the insert can succeed.
 */
export async function allocateHandle(
  exec: Exec,
  email: string,
  displayName?: string | null,
): Promise<string> {
  const seed = (displayName ?? email.split('@')[0] ?? 'brewer')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 24);
  const base = seed.length >= 3 ? seed : `brewer${seed}`.slice(0, 24);

  if (!(await handleExists(exec, base))) return base;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = String(Math.floor(Math.random() * 10_000)).padStart(4, '0');
    const candidate = `${base.slice(0, 27)}${suffix}`;
    if (!(await handleExists(exec, candidate))) return candidate;
  }
  throw new Error('could not allocate a free handle');
}

/** Fetches the OIDC userinfo document with the freshly obtained access token. */
export async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Google userinfo failed with ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  if (typeof body.sub !== 'string' || body.sub.length === 0) {
    throw new Error('Google userinfo response has no subject');
  }
  return {
    sub: body.sub,
    email: typeof body.email === 'string' ? body.email : undefined,
    // Strict boolean identity — a string "true" from a spoofed IdP must not pass.
    email_verified: body.email_verified === true,
    name: typeof body.name === 'string' ? body.name : undefined,
  };
}

/**
 * Registers the OAuth plugin when credentials are configured.
 * Returns false (after a warning) when they are not, so the caller can skip the
 * callback route and the app boots cleanly without Google.
 */
export function registerGoogleOAuthPlugin(app: FastifyInstance): boolean {
  const env = getEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    app.log.warn(
      'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not set — Google sign-in is disabled (DG §7.2).',
    );
    return false;
  }

  app.register(fastifyOauth2, {
    name: 'googleOAuth2',
    scope: ['openid', 'email', 'profile'],
    credentials: {
      client: { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET },
      auth: fastifyOauth2.GOOGLE_CONFIGURATION,
    },
    startRedirectPath: GOOGLE_START_PATH,
    // Exact-match against the console-registered redirect URI (DG §7.2 item 4).
    callbackUri: `${env.API_URL}${GOOGLE_CALLBACK_PATH}`,
    // OAuth 2.1 shape — the same code path iOS will use (EF §2.3).
    pkce: 'S256',
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction(),
    },
  });

  return true;
}
