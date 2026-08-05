/**
 * notifications — the public interface.
 *
 * Nothing outside this module may import its internals (dependency-cruiser
 * `api-no-cross-module-internals`). Everything another module legitimately
 * needs is re-exported here.
 *
 * ── DEPENDENCY DIRECTION, DELIBERATE ────────────────────────────────────────
 * This module imports identity (for `csrfGuard`) and NOTHING ELSE from the
 * module layer. In particular it does not import brewing, even though the
 * weekly recap is built entirely from brew data — because brewing imports THIS
 * module to announce a fork, and the pair would be circular.
 *
 * The recap therefore lives in the scheduler entrypoint, which is not a module
 * and may talk to both: it asks brewing for the numbers and this module for
 * permission to send. Composition happens at the root, which is exactly where
 * a cycle stops being a cycle (engineering_foundations §9.5).
 */
import type { FastifyInstance } from 'fastify';
import { query } from '../../lib/db.js';
import { registerNotificationRoutes as registerRoutes } from './routes.js';
import type { Exec } from './types.js';

export type { NotificationRoutesOptions } from './routes.js';

/**
 * The default seam: the shared pool, adapted to the `Exec` shape every module
 * here uses so the suite can substitute PGlite without a pool existing at all.
 */
export const defaultNotificationExec: Exec = (async (text, params) =>
  query(text, params as unknown[])) as Exec;

/** Mounts the routes. `exec` is injectable for tests; production uses the pool. */
export function registerNotificationRoutes(
  app: FastifyInstance,
  options: { exec?: Exec; prefix?: string } = {},
): void {
  registerRoutes(app, {
    exec: options.exec ?? defaultNotificationExec,
    ...(options.prefix ? { prefix: options.prefix } : {}),
  });
}

export {
  sendNotification,
  setNotificationMailer,
  type NotificationMailer,
  type NotificationMailMessage,
  type SendNotificationInput,
  type SendOutcome,
} from './service.js';

export {
  isEnabled,
  listPreferences,
  setPreference,
  findRecipient,
} from './repository.js';

export {
  NOTIFICATION_TYPES,
  NOTIFICATION_COPY,
  isNotificationType,
  type NotificationPreference,
  type NotificationRecipient,
  type NotificationType,
} from './types.js';

export {
  createUnsubscribeToken,
  unsubscribeUrl,
  verifyUnsubscribeToken,
  type UnsubscribeClaim,
} from './unsubscribe.js';

/**
 * The ISO week key the weekly recap dedupes on: `weekly_recap:2026-W32`.
 *
 * Exported because the scheduler builds it and the tests assert on it, and a
 * second implementation that computed the week slightly differently would let
 * the same digest go out twice in one week — the one failure this whole ledger
 * exists to prevent.
 */
export function weeklyRecapKey(when: Date): string {
  // ISO-8601 week: Thursday decides the year, weeks start Monday.
  const d = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()));
  const day = d.getUTCDay() || 7; // Sunday = 7, not 0
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `weekly_recap:${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
