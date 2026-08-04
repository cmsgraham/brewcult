import { buildApp } from './app.js';

const app = await buildApp();

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

// Graceful shutdown (EF §7.2): drain in-flight requests on SIGTERM so k8s /
// compose rolling restarts drop zero requests.
let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutdown signal received, draining');
  app
    .close()
    .then(() => {
      app.log.info('server closed cleanly');
      process.exit(0);
    })
    .catch((err: unknown) => {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error({ err }, 'failed to start api');
  process.exit(1);
}
