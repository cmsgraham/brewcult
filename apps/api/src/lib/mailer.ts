/**
 * SMTP transport and the BrewCult mail templates.
 *
 * Ported from the pattern proven in production on Zentra (`apps/api/src/lib/
 * mailer.ts` there): a cached transporter, a no-op when `SMTP_HOST` is empty,
 * and a boolean return that callers use for logging only — never to decide an
 * HTTP status. That last rule is load-bearing here: the identity module's
 * register/reset flows answer 202 regardless of delivery, because a status that
 * varies with mail success is an account-enumeration oracle.
 *
 * Deployment: dev points at the Mailpit container (SMTP_HOST=mailpit,
 * SMTP_PORT=1025) so flows complete offline with nothing leaving the machine;
 * production points at the self-hosted mail server (deployment_guide.md §8).
 */
import { createTransport, type Transporter } from 'nodemailer';
import { getEnv } from './env.js';

let cachedTransporter: Transporter | null = null;
let cachedDisabled = false;

/** Test seam — drops the memoised transporter so a test can re-read the env. */
export function resetMailerCache(): void {
  cachedTransporter = null;
  cachedDisabled = false;
}

function getTransporter(): Transporter | null {
  if (cachedDisabled) return null;
  if (cachedTransporter) return cachedTransporter;

  const env = getEnv();
  if (!env.SMTP_HOST) {
    cachedDisabled = true;
    return null;
  }
  cachedTransporter = createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE === 'true',
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
  });
  return cachedTransporter;
}

/**
 * Staging guard. With `MAIL_ALLOWLIST` set, only matching recipients receive
 * mail — so a staging bug can never mass-message real users. Supports exact
 * addresses and `*@domain` patterns, comma-separated. Empty = no restriction.
 */
export function isAllowedRecipient(to: string): boolean {
  const raw = getEnv().MAIL_ALLOWLIST.trim();
  if (!raw) return true;
  const address = to.toLowerCase();
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) =>
      entry.startsWith('*@') ? address.endsWith(entry.slice(1)) : address === entry,
    );
}

// --- Templates --------------------------------------------------------------

const BRAND = 'BrewCult';
const ESPRESSO = '#3B2A20';
const CREAM = '#F4EDE3';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Brand shell. Table-free, inline-styled, and readable as plain text too. */
function shell(heading: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:${CREAM};font-family:-apple-system,Segoe UI,Roboto,Helvetica,sans-serif;color:${ESPRESSO};">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;">
    <p style="margin:0 0 20px;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:${ESPRESSO};opacity:0.65;">${BRAND}</p>
    <h1 style="margin:0 0 16px;font-size:20px;color:${ESPRESSO};">${escapeHtml(heading)}</h1>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid ${CREAM};margin:28px 0 14px;">
    <p style="margin:0;font-size:12px;opacity:0.6;">${BRAND} · <a href="https://brewcult.coffee" style="color:${ESPRESSO};">brewcult.coffee</a></p>
  </div>
</body></html>`;
}

/**
 * The verification code, set large enough to read off a phone at arm's length
 * but NOT large enough to trip SpamAssassin.
 *
 * This was 30px, which fires HTML_FONT_SIZE_HUGE — a spam heuristic, because
 * enormous type is a shouting-headline tell. It is only a -0.001 penalty on its
 * own, but spam scoring is cumulative and a transactional mail that must reach
 * the inbox should not donate points for decoration. 22px with the same weight
 * and letter-spacing is just as scannable and scores clean.
 */
function codeBlock(code: string): string {
  return `<div style="font-size:22px;letter-spacing:8px;font-weight:700;background:${CREAM};border-radius:10px;padding:16px;text-align:center;margin:0 0 16px;">${escapeHtml(code)}</div>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:0 0 18px;"><a href="${escapeHtml(url)}" style="display:inline-block;background:${ESPRESSO};color:${CREAM};text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;">${escapeHtml(label)}</a></p>`;
}

function unsubscribeFooter(url: string): string {
  if (!url) return '';
  return `<p style="margin:14px 0 0;font-size:12px;opacity:0.6;">Don't want these? <a href="${escapeHtml(url)}" style="color:${ESPRESSO};">Turn them off</a> — it takes one click and won't affect security emails.</p>`;
}

export interface RenderedMail {
  text: string;
  html: string;
}

type TemplateData = Record<string, string>;

/**
 * Renders a template. Copy is warm and non-alarming per second_draft §10 —
 * these are the first words many people read from BrewCult.
 */
export function renderMail(template: string, data: TemplateData): RenderedMail {
  const code = data['code'] ?? '';
  const minutes = data['expires_in_minutes'] ?? '15';
  const appUrl = data['app_url'] ?? 'https://brewcult.coffee';
  const resetUrl = data['reset_url'] ?? appUrl;

  switch (template) {
    case 'verify_email':
      return {
        text: `Welcome to ${BRAND}.\n\nYour verification code is ${code}\n\nIt expires in ${minutes} minutes. If you didn't sign up, you can ignore this email.`,
        html: shell(
          'Confirm your email',
          `<p style="margin:0 0 16px;">Welcome to ${BRAND}. Use this code to confirm your email address:</p>${codeBlock(code)}<p style="margin:0;font-size:14px;opacity:0.75;">It expires in ${escapeHtml(minutes)} minutes. If you didn't sign up, you can ignore this email.</p>`,
        ),
      };

    case 'verify_email_change':
      return {
        text: `Confirm your new ${BRAND} email address.\n\nYour code is ${code}\n\nIt expires in ${minutes} minutes.`,
        html: shell(
          'Confirm your new address',
          `<p style="margin:0 0 16px;">Use this code to confirm the new email address on your account:</p>${codeBlock(code)}<p style="margin:0;font-size:14px;opacity:0.75;">It expires in ${escapeHtml(minutes)} minutes.</p>`,
        ),
      };

    case 'duplicate_registration':
      return {
        text: `Someone tried to create a ${BRAND} account with this email address, but you already have one.\n\nIf that was you, just sign in: ${appUrl}/login\nIf it wasn't, you can safely ignore this — no new account was created.`,
        html: shell(
          'You already have an account',
          `<p style="margin:0 0 16px;">Someone tried to create a ${BRAND} account with this email address. You already have one, so nothing was created.</p>${button(`${appUrl}/login`, 'Sign in instead')}<p style="margin:0;font-size:14px;opacity:0.75;">If this wasn't you, you can safely ignore this email. If you can't remember your password, use "forgot your password" on the sign-in page.</p>`,
        ),
      };

    case 'password_reset':
      return {
        text: `Someone (hopefully you) asked to reset your ${BRAND} password.\n\nOpen this link to choose a new one:\n${resetUrl}\n\nThe link works once and expires in an hour. If you didn't ask for this, you can ignore it — your password hasn't changed.`,
        html: shell(
          'Reset your password',
          `<p style="margin:0 0 16px;">Someone (hopefully you) asked to reset your password.</p>${button(resetUrl, 'Choose a new password')}<p style="margin:0 0 12px;font-size:13px;opacity:0.7;">Or paste this into your browser:</p><p style="margin:0 0 16px;font-size:12px;word-break:break-all;opacity:0.7;">${escapeHtml(resetUrl)}</p><p style="margin:0;font-size:14px;opacity:0.75;">The link works once and expires in an hour. If you didn't ask for this, ignore it — your password hasn't changed.</p>`,
        ),
      };

    case 'password_changed':
      return {
        text: `Your ${BRAND} password was just changed.\n\nIf that was you, nothing to do. If it wasn't, reset your password immediately: ${appUrl}/forgot-password`,
        html: shell(
          'Your password was changed',
          `<p style="margin:0 0 16px;">Your ${BRAND} password was just changed. If that was you, there's nothing to do.</p>${button(`${appUrl}/forgot-password`, "This wasn't me")}`,
        ),
      };

    case 'email_changed_notice':
      return {
        text: `The email address on your ${BRAND} account was changed.\n\nIf that wasn't you, contact support@brewcult.coffee straight away.`,
        html: shell(
          'Your email address was changed',
          `<p style="margin:0 0 16px;">The email address on your ${BRAND} account was changed.</p><p style="margin:0;font-size:14px;opacity:0.75;">If that wasn't you, email <a href="mailto:support@brewcult.coffee" style="color:${ESPRESSO};">support@brewcult.coffee</a> straight away.</p>`,
        ),
      };

    case 'mfa_enabled':
      return {
        text: `Two-factor authentication is now on for your ${BRAND} account.\n\nKeep your recovery codes somewhere safe — they're the way back in if you lose your device.`,
        html: shell(
          'Two-factor authentication is on',
          `<p style="margin:0 0 16px;">Two-factor authentication is now protecting your account.</p><p style="margin:0;font-size:14px;opacity:0.75;">Keep your recovery codes somewhere safe — they're the way back in if you lose your device.</p>`,
        ),
      };

    case 'mfa_disabled':
      return {
        text: `Two-factor authentication was turned off for your ${BRAND} account.\n\nIf that wasn't you, reset your password now: ${appUrl}/forgot-password`,
        html: shell(
          'Two-factor authentication is off',
          `<p style="margin:0 0 16px;">Two-factor authentication was turned off for your account.</p>${button(`${appUrl}/forgot-password`, "This wasn't me")}`,
        ),
      };

    /* --- notifications (switchable — see modules/notifications) ------------ */

    case 'weekly_recap': {
      const brews = data['brew_count'] ?? '0';
      const plural = brews === '1' ? 'brew' : 'brews';
      const highlight = data['highlight'] ?? '';
      const unsub = data['unsubscribe_url'] ?? '';
      return {
        text:
          `Your week in coffee.

You logged ${brews} ${plural}.` +
          (highlight ? `

${highlight}` : '') +
          `

See the detail: ${appUrl}/brew` +
          (unsub ? `

Turn these off: ${unsub}` : ''),
        html: shell(
          'Your week in coffee',
          `<p style="margin:0 0 16px;">You logged <strong>${escapeHtml(brews)} ${plural}</strong> this week.</p>` +
            (highlight
              ? `<p style="margin:0 0 16px;font-size:15px;">${escapeHtml(highlight)}</p>`
              : '') +
            button(`${appUrl}/brew`, 'See your brews') +
            unsubscribeFooter(unsub),
        ),
      };
    }

    case 'recipe_forked': {
      const title = data['recipe_title'] ?? 'your recipe';
      const who = data['forker_handle'] ?? 'Someone';
      const recipeUrl = data['recipe_url'] ?? `${appUrl}/recipes`;
      const unsub = data['unsubscribe_url'] ?? '';
      return {
        text:
          `${who} built on ${title}.

Forking is how a recipe travels — they now have their own copy to adjust.` +
          `

See it: ${recipeUrl}` +
          (unsub ? `

Turn these off: ${unsub}` : ''),
        html: shell(
          'Someone built on your recipe',
          `<p style="margin:0 0 16px;"><strong>${escapeHtml(who)}</strong> forked <strong>${escapeHtml(title)}</strong>.</p>` +
            `<p style="margin:0 0 16px;font-size:14px;opacity:0.75;">Forking is how a recipe travels — they have their own copy to adjust, and yours is untouched.</p>` +
            button(recipeUrl, 'See the fork') +
            unsubscribeFooter(unsub),
        ),
      };
    }

    default: {
      // An unknown template still sends something useful rather than nothing —
      // a missing case must not silently swallow a security notice.
      const lines = Object.entries(data)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
      return {
        text: `${BRAND}\n\n${lines}`,
        html: shell(BRAND, `<pre style="white-space:pre-wrap;margin:0;">${escapeHtml(lines)}</pre>`),
      };
    }
  }
}

// --- Sending ----------------------------------------------------------------

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /**
   * Extra SMTP headers. Used for List-Unsubscribe / List-Unsubscribe-Post on
   * anything a person can switch off — Gmail and Outlook surface their native
   * "unsubscribe" control from these, and a sender without them is treated as
   * one that does not offer the choice.
   */
  headers?: Record<string, string>;
}

export interface MailLogger {
  info?: (obj: object, msg: string) => void;
  warn?: (obj: object, msg: string) => void;
  error?: (obj: object, msg: string) => void;
}

/**
 * Best-effort send. Returns whether the SMTP server accepted the message.
 * Callers use the result for logging and metrics ONLY — never to shape a
 * response (see the enumeration note at the top of this file).
 */
export async function sendMail(message: MailMessage, log?: MailLogger): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    log?.warn?.(
      { to: message.to, subject: message.subject },
      'mailer disabled (SMTP_HOST empty) — not sent',
    );
    return false;
  }
  if (!isAllowedRecipient(message.to)) {
    log?.warn?.(
      { to: message.to, subject: message.subject },
      'recipient not in MAIL_ALLOWLIST — not sent',
    );
    return false;
  }

  try {
    const info = await transporter.sendMail({
      from: getEnv().SMTP_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html ?? message.text.replace(/\n/g, '<br>'),
      ...(message.headers ? { headers: message.headers } : {}),
    });
    log?.info?.(
      { to: message.to, subject: message.subject, messageId: (info as { messageId?: string }).messageId },
      'mail sent',
    );
    return true;
  } catch (err) {
    log?.error?.(
      { to: message.to, subject: message.subject, err: (err as Error).message },
      'mail send failed',
    );
    return false;
  }
}
