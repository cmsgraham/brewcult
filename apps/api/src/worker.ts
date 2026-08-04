/**
 * Worker entrypoint (EF §7.2): outbox relay + event consumers (feeds,
 * reputation, notifications) arrive with F-12. For now: a long-running
 * heartbeat process with graceful SIGTERM drain, so the container topology
 * (deployment_guide §3/§5.2) is real from day one.
 */
import { pino } from 'pino';

const log = pino({
  name: 'brewcult-worker',
  level: process.env.LOG_LEVEL ?? 'info',
});

const HEARTBEAT_MS = Number(process.env.WORKER_HEARTBEAT_MS ?? 30_000);

log.info({ heartbeat_ms: HEARTBEAT_MS }, 'worker started');

const heartbeat = setInterval(() => {
  log.info({ uptime_s: Math.round(process.uptime()) }, 'worker heartbeat');
}, HEARTBEAT_MS);

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'shutdown signal received, draining');
  clearInterval(heartbeat);
  // F-12: stop consuming, finish in-flight event handling, flush outbox cursor.
  log.info('worker stopped cleanly');
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
