/**
 * Outbound identity mail.
 *
 * The identity module knows *what* must be sent (verification code, reset link,
 * "your password changed" notice); it does not own SMTP. A notifications lane
 * injects a transport with `setIdentityMailer()`; with none configured the
 * module logs the message and continues — DG §9's "empty SMTP_HOST → the mailer
 * no-ops instead of throwing".
 *
 * Secrets (codes, reset tokens) are included in the *log* only outside
 * production, so local development can complete a flow without a mail server
 * while production never writes a live credential to disk.
 */
import type { FastifyBaseLogger } from 'fastify';
import { isProduction } from '../../lib/env.js';

export type IdentityMailTemplate =
  | 'verify_email'
  | 'verify_email_change'
  | 'duplicate_registration'
  | 'password_reset'
  | 'password_changed'
  | 'email_changed_notice'
  | 'mfa_enabled'
  | 'mfa_disabled';

export interface IdentityMailMessage {
  to: string;
  template: IdentityMailTemplate;
  subject: string;
  /**
   * Template variables. Keys listed in `secretKeys` are redacted from logs in
   * production.
   */
  data: Record<string, string>;
  secretKeys?: readonly string[];
}

export type IdentityMailer = (message: IdentityMailMessage) => Promise<void>;

let mailer: IdentityMailer | null = null;

/** Installs the transport. Called once at bootstrap by the notifications lane. */
export function setIdentityMailer(transport: IdentityMailer | null): void {
  mailer = transport;
}

function redact(message: IdentityMailMessage): Record<string, string> {
  if (!isProduction()) return message.data;
  const secrets = new Set(message.secretKeys ?? []);
  return Object.fromEntries(
    Object.entries(message.data).map(([key, value]) => [key, secrets.has(key) ? '[redacted]' : value]),
  );
}

/**
 * Best-effort delivery. A mail failure must never fail the HTTP request that
 * triggered it: a 500 on "register" that depends on SMTP being healthy is both
 * an availability bug and an enumeration oracle (the timing/status would differ
 * between the "send verification" and "send duplicate notice" branches).
 */
export async function sendIdentityMail(
  log: FastifyBaseLogger,
  message: IdentityMailMessage,
): Promise<void> {
  if (!mailer) {
    log.info(
      { mail: { to: message.to, template: message.template, data: redact(message) } },
      'identity mail not delivered — no transport configured',
    );
    return;
  }
  try {
    await mailer(message);
  } catch (err) {
    log.error({ err, template: message.template }, 'identity mail delivery failed');
  }
}
