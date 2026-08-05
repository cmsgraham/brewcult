/**
 * The one place that decides whether a switchable email may be sent.
 *
 * Callers describe WHAT happened; they never check a preference, never build an
 * unsubscribe link and never touch the ledger. Centralising that is the whole
 * point: a second code path that sends without asking is how a product ends up
 * mailing people who opted out, and no amount of care at the call sites
 * prevents it.
 *
 * The transport is injected the same way identity's is (`setNotificationMailer`)
 * so the suite asserts on real decisions with a fake transport, and an
 * unconfigured deployment degrades to "logged, not sent" rather than throwing.
 */
import { unsubscribeUrl } from './unsubscribe.js';
import {
  claimDelivery,
  findRecipient,
  isEnabled,
  releaseDelivery,
} from './repository.js';
import type { Exec, NotificationType } from './types.js';

export interface NotificationMailMessage {
  to: string;
  subject: string;
  template: NotificationType;
  data: Record<string, string>;
  /**
   * RFC 8058 one-click unsubscribe. Mailbox providers render their own native
   * control from these, which is both better for the recipient and better for
   * our reputation than making them hunt for a link in the footer.
   */
  headers: Record<string, string>;
}

export type NotificationMailer = (message: NotificationMailMessage) => Promise<void>;

let mailer: NotificationMailer | null = null;

/** Installs the transport. Called once at bootstrap by app.ts. */
export function setNotificationMailer(transport: NotificationMailer | null): void {
  mailer = transport;
}

export interface SendNotificationInput {
  userId: string;
  type: NotificationType;
  /** Idempotency key — see the 0009 header. Must be stable for the same event. */
  dedupeKey: string;
  subject: string;
  /** Template variables; `unsubscribe_url` is added here, never by the caller. */
  data?: Record<string, string>;
}

export type SendOutcome =
  | 'sent'
  | 'opted_out'
  | 'already_sent'
  | 'no_recipient'
  | 'not_configured'
  | 'failed';

export interface NotificationLogger {
  info?: (obj: object, msg: string) => void;
  warn?: (obj: object, msg: string) => void;
  error?: (obj: object, msg: string) => void;
}

/**
 * Send one notification, at most once.
 *
 * Order is deliberate and each step is a gate:
 *
 *   1. preference — cheapest, and the answer people care most about
 *   2. recipient  — an unverified or deactivated address is never mailed
 *   3. claim      — INSERT-and-catch, so a concurrent run loses the race here
 *   4. send       — and release the claim if the transport rejects, so the next
 *                   run may retry rather than the mail being lost forever
 *
 * Never throws. A notification that fails must not take down the request or the
 * job that triggered it: nobody should lose a fork because we could not tell
 * its author about it.
 */
export async function sendNotification(
  exec: Exec,
  input: SendNotificationInput,
  log?: NotificationLogger,
): Promise<SendOutcome> {
  const { userId, type, dedupeKey, subject } = input;

  try {
    if (!(await isEnabled(exec, userId, type))) return 'opted_out';

    const recipient = await findRecipient(exec, userId);
    if (!recipient) return 'no_recipient';

    if (!(await claimDelivery(exec, userId, type, dedupeKey))) return 'already_sent';

    if (!mailer) {
      // Claim stands: an unconfigured transport is a deployment state, not a
      // transient failure, and retrying every run would only repeat the log.
      log?.warn?.({ userId, type }, 'notification mailer not configured — not sent');
      return 'not_configured';
    }

    const unsubscribe = unsubscribeUrl(userId, type);
    try {
      await mailer({
        to: recipient.email,
        subject,
        template: type,
        data: { ...(input.data ?? {}), unsubscribe_url: unsubscribe },
        headers: {
          'List-Unsubscribe': `<${unsubscribe}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
    } catch (err) {
      await releaseDelivery(exec, userId, dedupeKey);
      log?.error?.({ userId, type, err: (err as Error).message }, 'notification send failed');
      return 'failed';
    }

    log?.info?.({ userId, type, dedupeKey }, 'notification sent');
    return 'sent';
  } catch (err) {
    log?.error?.({ userId, type, err: (err as Error).message }, 'notification aborted');
    return 'failed';
  }
}
