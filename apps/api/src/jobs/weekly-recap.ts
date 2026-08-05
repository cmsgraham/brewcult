/**
 * The weekly brew recap.
 *
 * ── WHY THIS LIVES IN jobs/ AND NOT IN A MODULE ─────────────────────────────
 * It needs brewing (the numbers) and notifications (permission to send). But
 * brewing already imports notifications to announce a fork, so a recap inside
 * notifications would close a cycle, and one inside brewing would put mail
 * policy in the wrong module. `jobs/` is the composition root for scheduled
 * work: not a module, allowed to talk to both, which is exactly where a cycle
 * stops being a cycle (engineering_foundations §9.5).
 *
 * ── WHAT IT SENDS ───────────────────────────────────────────────────────────
 * Your own brews, counted, for the week just ended. Nobody else's data, no
 * ranking, no "you're falling behind". §10 of the product design is explicit
 * that streak-shaming is off the table, so this reports and does not nag — and
 * a week with nothing in it produces NO email at all rather than a reminder
 * that you did not brew.
 *
 * ── IDEMPOTENCY ─────────────────────────────────────────────────────────────
 * The dedupe key is the ISO week, so every run inside the same week after the
 * first is a no-op per user. That is what makes it safe for a scheduler with no
 * distributed lock, restarted by every deploy.
 */
import { query } from '../lib/db.js';
import {
  sendNotification,
  weeklyRecapKey,
  type SendOutcome,
} from '../modules/notifications/index.js';

export interface RecapLogger {
  info?: (obj: object, msg: string) => void;
  warn?: (obj: object, msg: string) => void;
  error?: (obj: object, msg: string) => void;
}

interface RecapRow {
  user_id: string;
  brew_count: number;
  distinct_coffees: number;
  best_verdict: string | null;
}

/**
 * One row per user who logged at least one brew in the window.
 *
 * Deliberately a single aggregate rather than a per-user query in a loop: the
 * job must stay O(1) round trips as the user base grows, and a digest that
 * takes longer to assemble than the window it covers is a digest that
 * eventually stops going out.
 */
export async function collectRecaps(sinceDays = 7): Promise<RecapRow[]> {
  const res = await query<RecapRow>(
    `SELECT b.user_id::text                      AS user_id,
            count(*)::int                        AS brew_count,
            count(DISTINCT b.coffee_product_id)::int AS distinct_coffees,
            -- taste is jsonb (0006), so the verdict is a path lookup, not a
            -- column. Reading it as a column silently returns nothing.
            (SELECT b2.taste->>'verdict'
               FROM brew_sessions b2
              WHERE b2.user_id = b.user_id
                AND b2.created_at >= now() - ($1::int * INTERVAL '1 day')
                AND b2.deleted_at IS NULL
                AND b2.taste->>'verdict' = 'good'
              LIMIT 1)                           AS best_verdict
       FROM brew_sessions b
      WHERE b.created_at >= now() - ($1::int * INTERVAL '1 day')
        AND b.deleted_at IS NULL
      GROUP BY b.user_id`,
    [sinceDays],
  );
  return res.rows;
}

/** Human line for the body. Warm, factual, never a scoreboard. */
export function recapHighlight(row: RecapRow): string {
  const parts: string[] = [];
  if (row.distinct_coffees > 1) {
    parts.push(`across ${row.distinct_coffees} different coffees`);
  }
  if (row.best_verdict === 'good') {
    parts.push('and at least one you called a keeper');
  }
  return parts.length > 0 ? `Nice week — ${parts.join(' ')}.` : '';
}

export interface RecapResult {
  considered: number;
  outcomes: Record<SendOutcome, number>;
}

/** Runs one pass. Never throws — a failed digest must not kill the scheduler. */
export async function runWeeklyRecap(
  now: Date,
  log?: RecapLogger,
): Promise<RecapResult> {
  const outcomes: Record<SendOutcome, number> = {
    sent: 0,
    opted_out: 0,
    already_sent: 0,
    no_recipient: 0,
    not_configured: 0,
    failed: 0,
  };

  let rows: RecapRow[] = [];
  try {
    rows = await collectRecaps();
  } catch (err) {
    log?.error?.({ err: (err as Error).message }, 'weekly recap: could not collect');
    return { considered: 0, outcomes };
  }

  const dedupeKey = weeklyRecapKey(now);

  for (const row of rows) {
    // A quiet week gets silence, not a nudge (see the header).
    if (row.brew_count < 1) continue;

    const outcome = await sendNotification(
      // The pooled exec, adapted inline: this file is a composition root and
      // has no business owning a seam of its own.
      (async (text, params) => query(text, params as unknown[])) as Parameters<
        typeof sendNotification
      >[0],
      {
        userId: row.user_id,
        type: 'weekly_recap',
        dedupeKey,
        subject: 'Your week in coffee',
        data: {
          brew_count: String(row.brew_count),
          highlight: recapHighlight(row),
        },
      },
      log,
    );
    outcomes[outcome] += 1;
  }

  log?.info?.({ considered: rows.length, ...outcomes }, 'weekly recap pass complete');
  return { considered: rows.length, outcomes };
}
