/**
 * Notification routes.
 *
 *   GET   /v1/notifications/preferences     signed in — what am I subscribed to
 *   PATCH /v1/notifications/preferences     signed in — change one switch
 *   POST  /v1/notifications/unsubscribe     PUBLIC, token — RFC 8058 one-click
 *   GET   /v1/notifications/unsubscribe     PUBLIC, token — the human click
 *
 * The unsubscribe pair is deliberately outside every auth and CSRF guard, and
 * that is safe for a specific reason: the token IS the authorisation, it is
 * scoped to one user and one type, and the only state it can reach is turning
 * that one thing OFF. See unsubscribe.ts for why it cannot be used to opt in.
 *
 * CSRF in particular must NOT apply to the POST. Mailbox providers issue that
 * request themselves with no cookies, no Origin we control and no opportunity
 * to fetch a token; a CSRF guard there would simply break one-click
 * unsubscribe, which is the thing Gmail and Outlook check for.
 */
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../lib/auth-plugin.js';
import { badRequest } from '../../lib/errors.js';
import { csrfGuard } from '../identity/index.js';
import { listPreferences, setPreference } from './repository.js';
import { okResponseSchema, preferencesResponseSchema, updatePreferenceBody } from './schemas.js';
import type { Exec } from './types.js';
import { verifyUnsubscribeToken } from './unsubscribe.js';

export interface NotificationRoutesOptions {
  exec: Exec;
  prefix?: string;
}

export function registerNotificationRoutes(
  app: FastifyInstance,
  options: NotificationRoutesOptions,
): void {
  const prefix = options.prefix ?? '/v1';
  const exec = options.exec;

  app.get(
    `${prefix}/notifications/preferences`,
    {
      preHandler: requireAuth,
      schema: {
        tags: ['notifications'],
        summary: 'Every notification type with its effective setting',
        response: { 200: preferencesResponseSchema },
      },
    },
    async (request) => ({ preferences: await listPreferences(exec, request.actor.userId!) }),
  );

  app.patch(
    `${prefix}/notifications/preferences`,
    {
      preHandler: [requireAuth, csrfGuard],
      schema: {
        tags: ['notifications'],
        summary: 'Turn one notification type on or off',
        response: { 200: preferencesResponseSchema },
      },
    },
    async (request) => {
      const parsed = updatePreferenceBody.safeParse(request.body);
      if (!parsed.success) throw badRequest('Invalid request.');

      await setPreference(
        exec,
        request.actor.userId!,
        parsed.data.type,
        parsed.data.email_enabled,
      );
      return { preferences: await listPreferences(exec, request.actor.userId!) };
    },
  );

  /**
   * One-click unsubscribe.
   *
   * Answers 200 for a bad token as readily as a good one. A mail client that
   * gets a 4xx may retry or surface an error to somebody who was only trying to
   * stop email, and distinguishing the two states tells a prober whether a
   * token (and therefore a user id) is real. Either way the effect is the same
   * from outside: no more of that kind of mail.
   */
  const handleUnsubscribe = async (token: string | undefined) => {
    const claim = token ? verifyUnsubscribeToken(token) : null;
    if (claim) await setPreference(exec, claim.userId, claim.type, false);
    return { status: 'ok' as const };
  };

  app.post(
    `${prefix}/notifications/unsubscribe`,
    {
      schema: {
        tags: ['notifications'],
        summary: 'RFC 8058 one-click unsubscribe (no session, token authorises)',
        response: { 200: okResponseSchema },
      },
    },
    async (request) => {
      const fromQuery = (request.query as { token?: string } | undefined)?.token;
      const fromBody = (request.body as { token?: string } | undefined)?.token;
      return handleUnsubscribe(fromQuery ?? fromBody);
    },
  );

  app.get(
    `${prefix}/notifications/unsubscribe`,
    {
      schema: {
        tags: ['notifications'],
        summary: 'Unsubscribe from a link in an email (no session required)',
        response: { 200: okResponseSchema },
      },
    },
    async (request) => handleUnsubscribe((request.query as { token?: string } | undefined)?.token),
  );
}
