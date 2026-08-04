import Fastify, { type FastifyInstance } from 'fastify';
import { type HealthStatus } from '@brewcult/shared-types';

function health(status: HealthStatus['status']): HealthStatus {
  return {
    status,
    service: 'api',
    uptime_s: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Builds the Fastify app (separated from listen() for testability).
 *
 * Domain modules (identity, catalog, brewing, …) register their routes here in
 * Wave 2+ via their public interfaces (apps/api/src/modules/<m>/index.ts).
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });

  /** Liveness: the process is up (container healthcheck target, F-18). */
  app.get('/healthz', async () => health('ok'));

  /**
   * Readiness: safe to receive traffic. Wave 2+ adds dependency probes
   * (Postgres, Redis) and reports 'degraded' with a 503 when they fail.
   */
  app.get('/readyz', async () => health('ok'));

  return app;
}
