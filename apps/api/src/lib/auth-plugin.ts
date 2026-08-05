/**
 * Request-actor decoration — EF §2.3 / §3.2.
 *
 * This plugin is the ONLY place an inbound credential is turned into an
 * `Actor`. Everything downstream (route handlers, the policy layer, the AI tool
 * layer) reads `request.actor` and never re-parses tokens. Requests without a
 * valid access token are ANONYMOUS — never an error at this stage, because
 * "is this endpoint public?" is the policy layer's question, not the
 * transport's.
 *
 * It is wrapped in `fastify-plugin` so the decorator and the onRequest hook
 * apply to the whole application, not just the encapsulated scope that
 * registered it. Registration is idempotent: `registerIdentityRoutes()` calls
 * it too, so an app that forgets to register it still gets actors.
 */
import fp from 'fastify-plugin';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { ANONYMOUS, type Actor, type Role } from './policy.js';
import { getEnv, isProduction } from './env.js';
import { unauthorized } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `authPlugin` on every request. ANONYMOUS when unauthenticated. */
    actor: Actor;
    /**
     * Refresh-token family (session) this access token belongs to; null when
     * anonymous. Kept beside the actor rather than inside it because
     * `lib/policy.ts` owns the `Actor` shape and sessions are a transport
     * concern.
     */
    sessionId: string | null;
  }
}

/** Cookie carrying the 15-minute access token (web transport). */
export const ACCESS_COOKIE = 'bc_access';
/** Cookie carrying the rotating refresh token, scoped to the auth path. */
export const REFRESH_COOKIE = 'bc_refresh';
/**
 * The refresh cookie's path scope now lives in the environment as
 * `AUTH_COOKIE_PATH`, because it must be written the way the BROWSER sees the
 * URL, and the gateway prefix is a deployment fact this module cannot know.
 *
 * It used to be the constant `'/v1/auth'` — the API's own internal route. Caddy
 * strips `/api` server-side, so the browser was requesting
 * `/api/v1/auth/refresh`, path matching failed, and `bc_refresh` was NEVER sent
 * on any request. Sessions therefore died silently 15 minutes after login (when
 * the access token expired) with no way to renew, and signing in again bought
 * only another 15 minutes.
 *
 * The old path is kept solely so logout can also clear cookies issued before
 * the fix; nothing should scope a NEW cookie to it.
 */
export const LEGACY_AUTH_COOKIE_PATH = '/v1/auth';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** JWT `iss`/`aud` — verified on every token, so tokens minted for another
 *  BrewCult service can never authenticate against this API. */
export const JWT_ISSUER = 'brewcult';
export const JWT_AUDIENCE = 'brewcult-api';

const ROLES: readonly Role[] = ['user', 'moderator', 'editor', 'seller_owner', 'admin'];

/** Claims of a normal access token (`typ: 'access'`). */
export interface AccessTokenPayload {
  sub: string;
  role: Role;
  /** True when this session cleared an MFA challenge (EF §2.3, isStaff gate). */
  mfa: boolean;
  /** Refresh-token family this access token belongs to (session identifier). */
  sid: string;
  typ: 'access';
}

/**
 * A token issued *after* a correct password but *before* the TOTP challenge.
 * Deliberately a different `typ` so it can never be presented as an access
 * token: the actor decoder rejects anything that is not `typ: 'access'`.
 */
export interface MfaChallengePayload {
  sub: string;
  typ: 'mfa_challenge';
}

const DEV_JWT_SECRET = 'dev-only-insecure-secret-change-me';

/** Reads the bearer token from the Authorization header, then the cookie. */
function extractAccessToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header === 'string') {
    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() === 'bearer' && value) return value;
    // A malformed Authorization header is not silently downgraded to the
    // cookie: that would let an attacker's header shadow the real session.
    return null;
  }
  const cookies = (request as FastifyRequest & { cookies?: Record<string, string | undefined> }).cookies;
  return cookies?.[ACCESS_COOKIE] ?? null;
}

function toActor(payload: AccessTokenPayload): Actor | null {
  if (payload.typ !== 'access') return null;
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
  if (!ROLES.includes(payload.role)) return null;
  return { userId: payload.sub, role: payload.role, mfa: payload.mfa === true };
}

/**
 * Registers cookie + JWT support (idempotently) and decorates `request.actor`.
 */
export const authPlugin = fp(
  async (app: FastifyInstance) => {
    const env = getEnv();

    // Fail fast rather than serve production traffic signed with the dev key.
    if (isProduction() && (env.JWT_SECRET === DEV_JWT_SECRET || env.JWT_SECRET.length < 32)) {
      throw new Error(
        'JWT_SECRET must be set to a unique value of at least 32 characters in production (DG §9).',
      );
    }

    if (!app.hasReplyDecorator('setCookie')) {
      await app.register(fastifyCookie);
    }

    if (!app.hasDecorator('jwt')) {
      await app.register(fastifyJwt, {
        secret: env.JWT_SECRET,
        sign: { iss: JWT_ISSUER, aud: JWT_AUDIENCE, expiresIn: ACCESS_TOKEN_TTL_SECONDS },
        verify: { allowedIss: JWT_ISSUER, allowedAud: JWT_AUDIENCE },
      });
    }

    if (app.hasRequestDecorator('actor')) return; // already installed

    // Declared without a value: Fastify 5 refuses reference-type request
    // decorators, and the onRequest hook below sets both on every request
    // before any handler or hook of the application can observe them.
    app.decorateRequest('actor');
    app.decorateRequest('sessionId');

    app.addHook('onRequest', async (request) => {
      request.actor = ANONYMOUS;
      request.sessionId = null;

      const raw = extractAccessToken(request);
      if (!raw) return;

      try {
        const payload = app.jwt.verify<AccessTokenPayload>(raw);
        const actor = toActor(payload);
        if (actor) {
          request.actor = actor;
          request.sessionId = typeof payload.sid === 'string' ? payload.sid : null;
        }
      } catch {
        // Expired / tampered / wrong-issuer token: stay anonymous. Handlers that
        // require authentication answer 401 through `requireAuth` or the policy
        // layer, so a bad token and no token are indistinguishable to callers.
      }
    });
  },
  { name: 'brewcult-auth', fastify: '5.x' },
);

/** preHandler that rejects anonymous callers with a 401. */
export const requireAuth: preHandlerHookHandler = async (request) => {
  if (request.actor.userId === null) throw unauthorized();
};
