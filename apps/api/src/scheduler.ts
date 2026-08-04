/**
 * Scheduler entrypoint (EF §7.2): cron-style jobs — retention deletion (EF
 * §4.2), digests, nightly backups, batch AI (AI-13) — arrive in later waves.
 * For now: a long-running heartbeat process with graceful SIGTERM drain, so
 * the container topology (deployment_guide §3/§5.2) is real from day one.
 */
import { pino } from 'pino';

const log = pino({
  name: 'brewcult-scheduler',
  level: process.env.LOG_LEVEL ?? 'info',
});

const HEARTBEAT_MS = Number(process.env.SCHEDULER_HEARTBEAT_MS ?? 60_000);

log.info({ heartbeat_ms: HEARTBEAT_MS }, 'scheduler started');

const heartbeat = setInterval(() => {
  log.info({ uptime_s: Math.round(process.uptime()) }, 'scheduler heartbeat');
}, HEARTBEAT_MS);

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'shutdown signal received, draining');
  clearInterval(heartbeat);
  // Later waves: let the in-flight job finish (or checkpoint), then exit.
  log.info('scheduler stopped cleanly');
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
