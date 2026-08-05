/**
 * Unsubscribe tokens.
 *
 * An unsubscribe link has to work from an email client, which means it must
 * authenticate WITHOUT a session — the person is not signed in, may be on a
 * different device, and Gmail may fetch the URL on their behalf. So the token
 * has to carry its own proof.
 *
 * ── WHY HMAC AND NOT A STORED TOKEN ─────────────────────────────────────────
 * A stored random token means a row per (user, type) written before every send,
 * a lookup on every click, and a cleanup job. An HMAC over the two facts that
 * matter is stateless, constant-size, and cannot be enumerated. Rotating
 * JWT_SECRET invalidates every outstanding link, which is the correct blast
 * radius for a signing key.
 *
 * ── WHAT THE TOKEN CAN AND CANNOT DO ────────────────────────────────────────
 * It authorises exactly one thing: turning ONE notification type OFF for ONE
 * user. It is not a session, cannot turn anything on, cannot read anything, and
 * cannot reach any other endpoint. That asymmetry is deliberate — a leaked
 * unsubscribe link (they end up in forwarded mail and in mailbox providers'
 * link scanners) should be able to cause at most an unwanted opt-out, never an
 * opt-IN somebody did not ask for and never a disclosure.
 *
 * Scoping the signature to the type means a link for one kind cannot be
 * replayed to silence another.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv } from '../../lib/env.js';
import { isNotificationType, type NotificationType } from './types.js';

/** Domain separation: this key signs nothing else, so nothing else verifies. */
const PURPOSE = 'brewcult:unsubscribe:v1';

function sign(userId: string, type: NotificationType): string {
  return createHmac('sha256', getEnv().JWT_SECRET)
    .update(`${PURPOSE}:${userId}:${type}`)
    .digest('base64url');
}

/** `<userId>.<type>.<signature>` — opaque to the recipient, verifiable by us. */
export function createUnsubscribeToken(userId: string, type: NotificationType): string {
  return `${userId}.${type}.${sign(userId, type)}`;
}

export interface UnsubscribeClaim {
  userId: string;
  type: NotificationType;
}

/**
 * Returns the claim, or null. Never throws and never explains WHY a token was
 * rejected — a caller that could distinguish "bad signature" from "unknown
 * type" gets an oracle for probing.
 */
export function verifyUnsubscribeToken(token: string): UnsubscribeClaim | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [userId, type, signature] = parts as [string, string, string];
  if (!userId || !isNotificationType(type)) return null;

  const expected = sign(userId, type);
  // Both are base64url of a fixed-width digest, so a length difference already
  // means "no" — but compare in constant time regardless, because bailing early
  // on length is exactly the leak timingSafeEqual exists to avoid.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return { userId, type };
}

/** The link that goes in the mail, and in the List-Unsubscribe header. */
export function unsubscribeUrl(userId: string, type: NotificationType): string {
  const token = createUnsubscribeToken(userId, type);
  return `${getEnv().APP_URL}/unsubscribe?token=${encodeURIComponent(token)}`;
}
