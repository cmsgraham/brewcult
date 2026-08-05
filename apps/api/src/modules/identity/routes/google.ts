/**
 * Google sign-in callback — DG §7.2, backlog ID-05.
 *
 * Mounted at the ROOT of the API (`/auth/google/callback`), not under `/v1`,
 * because that exact string is what the operator registers in the Google
 * console (DG §7.2 runbook step 3) and `redirect_uri` is matched byte for byte.
 *
 * The whole route is registered only when credentials exist; with none, the app
 * boots without it and the web client hides the button.
 */
import type { FastifyInstance } from 'fastify';
import { transaction } from '../../../lib/db.js';
import { getEnv } from '../../../lib/env.js';
import { recordAuditEvent } from '../audit.js';
import { setSessionCookies } from '../cookies.js';
import { clientExec, poolExec, requestContext } from '../context.js';
import {
  GOOGLE_CALLBACK_PATH,
  fetchGoogleProfile,
  registerGoogleOAuthPlugin,
  resolveGoogleIdentity,
} from '../google.js';
import { recordLoginAttempt } from '../login-attempts.js';
import { findUserMfa, touchLastSeen } from '../repo.js';
import { issueSession, signMfaChallengeToken } from '../tokens.js';

/**
 * Returns true when Google sign-in was wired up. Never throws on missing
 * configuration — that is a supported deployment, not an error.
 */
export function registerGoogleRoutes(app: FastifyInstance): boolean {
  if (!registerGoogleOAuthPlugin(app)) return false;

  app.get(
    GOOGLE_CALLBACK_PATH,
    {
      schema: {
        tags: ['identity'],
        summary: 'Google OAuth callback (authorization-code + PKCE)',
        querystring: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            state: { type: 'string' },
            error: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const env = getEnv();
      const context = requestContext(request);
      // `/login`, not `/sign-in`. The web app has no /sign-in route, so every
      // failure path here used to dead-end on the 404 page with the reason in
      // the query string and no way back.
      const failureRedirect = `${env.APP_URL}/login?error=`;

      const namespace = app.googleOAuth2;
      if (!namespace) return reply.redirect(`${failureRedirect}google_unavailable`);

      // The plugin verifies `state` and the PKCE verifier before we get here.
      let accessToken: string;
      try {
        const token = await namespace.getAccessTokenFromAuthorizationCodeFlow(request);
        accessToken = token.token.access_token;
      } catch (err) {
        request.log.warn({ err }, 'google authorization-code exchange failed');
        await recordLoginAttempt(poolExec, {
          email: null,
          success: false,
          provider: 'google',
          failureReason: 'provider_denied',
          ip: context.ip,
          userAgent: context.userAgent,
        });
        return reply.redirect(`${failureRedirect}google_denied`);
      }

      let profile;
      try {
        profile = await fetchGoogleProfile(accessToken);
      } catch (err) {
        request.log.warn({ err }, 'google userinfo fetch failed');
        return reply.redirect(`${failureRedirect}google_denied`);
      }

      const outcome = await transaction(async (client) =>
        resolveGoogleIdentity(clientExec(client), profile, context),
      );

      if (outcome.kind === 'refused') {
        return reply.redirect(`${failureRedirect}${outcome.reason}`);
      }

      const user = outcome.user;
      if (user.status !== 'active') {
        await recordLoginAttempt(poolExec, {
          email: user.email,
          userId: user.id,
          success: false,
          provider: 'google',
          failureReason: 'account_not_active',
          ip: context.ip,
          userAgent: context.userAgent,
        });
        return reply.redirect(`${failureRedirect}account_not_active`);
      }

      // A Google assertion is one factor. If the account has TOTP on, the
      // browser is sent back to finish the challenge rather than being handed
      // a full session — otherwise OAuth would be an MFA bypass.
      const mfa = await findUserMfa(poolExec, user.id);
      if (mfa?.confirmed_at) {
        const challenge = signMfaChallengeToken(app, user.id);
        // There is no /sign-in/mfa page — the MFA step is leg two of the login
        // form, driven by component state. Sending the challenge as a query
        // param on /login lets that form open directly on the code step, which
        // is the difference between "enter your code" and a 404 holding a live
        // challenge token. Before this, ANY account with TOTP enabled could not
        // complete Google sign-in at all.
        return reply.redirect(
          `${env.APP_URL}/login?mfa_token=${encodeURIComponent(challenge)}`,
        );
      }

      const session = await transaction(async (client) => {
        const exec = clientExec(client);
        const issued = await issueSession(app, exec, {
          userId: user.id,
          role: user.role,
          mfa: false,
          context,
        });
        await touchLastSeen(exec, user.id);
        await recordLoginAttempt(exec, {
          email: user.email,
          userId: user.id,
          success: true,
          provider: 'google',
          ip: context.ip,
          userAgent: context.userAgent,
        });
        await recordAuditEvent(exec, {
          actorId: user.id,
          action: 'auth.login_succeeded',
          targetType: 'user',
          targetId: user.id,
          payload: { provider: 'google', outcome: outcome.kind, family_id: issued.familyId },
        });
        return issued;
      });

      setSessionCookies(reply, session);
      return reply.redirect(`${env.APP_URL}/`);
    },
  );

  return true;
}
