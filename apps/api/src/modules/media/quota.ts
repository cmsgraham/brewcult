/**
 * Per-user upload budget — EF §3.3 ("rate limiting is central middleware,
 * per-IP + per-account + per-route class").
 *
 * Uploads are the most expensive anonymous-ish operation the platform offers:
 * every one costs CPU (a full decode + two encodes) and permanent bytes. The
 * per-account budget below is the account-scoped half of that control; a
 * per-IP limiter belongs in the central middleware when it lands (F-xx) and is
 * complementary, not a substitute — one attacker, one account, one IP would
 * otherwise be limited only by their bandwidth.
 *
 * THREE ceilings, because they fail differently:
 *   • COUNT per rolling window — bounds CPU burn and thumbnail spam.
 *   • BYTES per rolling window — bounds bandwidth. Counts deleted media too:
 *     without that, "upload 5 MB, delete, repeat" is an unmetered loop.
 *   • TOTAL BYTES — bounds what the account actually holds, forever. This is
 *     the one that stops a slow hoarder nobody notices.
 *
 * The window is rolling rather than a calendar day on purpose: a midnight reset
 * hands an abuser a fresh budget at a predictable moment and produces a
 * thundering herd at 00:00 UTC.
 *
 * Staff catalog uploads are NOT metered here: they are platform content, made
 * by MFA-gated editorial accounts, and metering them would mean a bulk catalog
 * import fails halfway through. The gate on that surface is `isStaff`.
 *
 * The numbers are module constants rather than env vars because `lib/env.ts` is
 * outside this lane; they are one small refactor away from
 * MEDIA_QUOTA_* variables if operations wants to tune them without a deploy.
 */

import { tooManyRequests } from '../../lib/errors.js';
import { quotaUsage } from './repository.js';
import type { MediaDb, QuotaUsage } from './types.js';

/** Rolling window, in hours. */
export const QUOTA_WINDOW_HOURS = 24;

/** Uploads per user per window. */
export const QUOTA_MAX_UPLOADS = 50;

/** Bytes per user per window (100 MB — 20 full-size uploads at the 5 MB cap). */
export const QUOTA_MAX_WINDOW_BYTES = 100 * 1024 * 1024;

/** Lifetime stored bytes per user (500 MB of re-encoded WebP is a lot of brews). */
export const QUOTA_MAX_TOTAL_BYTES = 500 * 1024 * 1024;

export interface QuotaDecision {
  usage: QuotaUsage;
  /** Remaining uploads in the window; never negative. */
  remaining: number;
}

const mb = (bytes: number): number => Math.round(bytes / (1024 * 1024));

/**
 * Throws 429 with a message a human can act on when any ceiling is hit.
 *
 * "Friendly" is a requirement, not a courtesy: the person who hits this is
 * almost always an enthusiastic user logging a weekend of brews, not an
 * attacker, and a bare "rate limited" tells them nothing about when they can
 * try again.
 */
export async function enforceUploadQuota(db: MediaDb, userId: string): Promise<QuotaDecision> {
  const usage = await quotaUsage(db, userId, QUOTA_WINDOW_HOURS);

  if (usage.count >= QUOTA_MAX_UPLOADS) {
    throw tooManyRequests(
      `You've uploaded ${QUOTA_MAX_UPLOADS} images in the last ${QUOTA_WINDOW_HOURS} hours, ` +
        'which is the daily limit. It frees up as those uploads age out — try again later today.',
    );
  }

  if (usage.window_bytes >= QUOTA_MAX_WINDOW_BYTES) {
    throw tooManyRequests(
      `You've uploaded ${mb(QUOTA_MAX_WINDOW_BYTES)} MB of images in the last ` +
        `${QUOTA_WINDOW_HOURS} hours, which is the daily limit. Try again later today.`,
    );
  }

  if (usage.total_bytes >= QUOTA_MAX_TOTAL_BYTES) {
    throw tooManyRequests(
      `Your photos take up ${mb(usage.total_bytes)} MB, which is the ` +
        `${mb(QUOTA_MAX_TOTAL_BYTES)} MB storage limit for an account. ` +
        'Delete some older photos to free up space.',
    );
  }

  return { usage, remaining: Math.max(0, QUOTA_MAX_UPLOADS - usage.count) };
}
