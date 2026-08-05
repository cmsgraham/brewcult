/**
 * Scheduler entrypoint (EF §7.2): cron-style jobs — retention deletion (EF
 * §4.2), digests, nightly backups, batch AI (AI-13) — arrive in later waves.
 * For now: a long-running heartbeat process with graceful SIGTERM drain, so
 * the container topology (deployment_guide §3/§5.2) is real from day one.
 */
import { pino } from 'pino';
import { runWeeklyRecap } from './jobs/weekly-recap.js';

const log = pino({
  name: 'brewcult-scheduler',
  level: process.env.LOG_LEVEL ?? 'info',
});

const HEARTBEAT_MS = Number(process.env.SCHEDULER_HEARTBEAT_MS ?? 60_000);

log.info({ heartbeat_ms: HEARTBEAT_MS }, 'scheduler started');

const heartbeat = setInterval(() => {
  log.info({ uptime_s: Math.round(process.uptime()) }, 'scheduler heartbeat');
}, HEARTBEAT_MS);

/**
 * Weekly recap.
 *
 * Swept hourly rather than "once a week at 09:00", because this process has no
 * cron and no leader election — it is restarted by every deploy, so anything
 * that fires on a single instant would be missed by whichever restart happened
 * to straddle it. The delivery ledger keys on the ISO week (0009), so sweeping
 * often is free: the first pass of a week sends, every later pass is a no-op.
 *
 * Set SCHEDULER_RECAP=0 to disable — useful on a staging box that shares a
 * database snapshot with production and must not mail anybody.
 */
const RECAP_ENABLED = process.env.SCHEDULER_RECAP !== '0';
const RECAP_SWEEP_MS = Number(process.env.SCHEDULER_RECAP_SWEEP_MS ?? 3_600_000);

async function recapSweep(): Promise<void> {
  try {
    await runWeeklyRecap(new Date(), log);
  } catch (err) {
    // runWeeklyRecap already swallows its own failures; this is the backstop
    // for anything thrown before it gets going. The scheduler must survive.
    log.error({ err }, 'weekly recap sweep threw');
  }
}

const recap = RECAP_ENABLED ? setInterval(() => void recapSweep(), RECAP_SWEEP_MS) : null;
if (RECAP_ENABLED) {
  log.info({ sweep_ms: RECAP_SWEEP_MS }, 'weekly recap sweep enabled');
  void recapSweep(); // catch up immediately on boot rather than after an hour
} else {
  log.warn('weekly recap DISABLED by SCHEDULER_RECAP=0');
}

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'shutdown signal received, draining');
  clearInterval(heartbeat);
  if (recap) clearInterval(recap);
  // Later waves: let the in-flight job finish (or checkpoint), then exit.
  log.info('scheduler stopped cleanly');
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
