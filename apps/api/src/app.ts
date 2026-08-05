import Fastify, { type FastifyInstance } from 'fastify';
import { type HealthStatus } from '@brewcult/shared-types';
import { registerErrorHandler } from './lib/errors.js';
import { registerIdentityRoutes } from './modules/identity/index.js';
import { registerCatalogRoutes } from './modules/catalog/index.js';
import { registerBrewingRoutes } from './modules/brewing/index.js';
import { registerAdminRoutes } from './modules/admin/index.js';

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
 * Domain modules register through their public interface only
 * (apps/api/src/modules/<m>/index.ts) — dependency-cruiser enforces that no
 * module reaches into another module's internals (EF §1.2).
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });

  // Must be registered before any route: without it, AuthorizationError and the
  // typed ApiError helpers (notFound/conflict/...) all surface as bare 500s.
  registerErrorHandler(app);

  /** Liveness: the process is up (container healthcheck target, F-18). */
  app.get('/healthz', async () => health('ok'));

  /**
   * Readiness: safe to receive traffic. Wave 3 adds dependency probes
   * (Postgres, Redis) and reports 'degraded' with a 503 when they fail.
   */
  app.get('/readyz', async () => health('ok'));

  /**
   * Client capability document (EF §2.5). Web and — later — iOS read this to
   * gate features and detect an unsupported client version, so behaviour can
   * change server-side without shipping a new build.
   */
  app.get('/v1/client-config', async () => ({
    min_supported_version: '0.1.0',
    features: {
      googleAuth: Boolean(process.env.GOOGLE_CLIENT_ID),
      marketplace: false,
      news: false,
      community: false,
      brewLogger: true,
      navBrew: true,
    },
  }));

  // Identity first: it installs the actor plugin, CSRF and the identity
  // policies that the catalog's staff-only routes authorize against.
  await registerIdentityRoutes(app);
  await registerCatalogRoutes(app);
  await registerBrewingRoutes(app);
  await registerAdminRoutes(app);

  return app;
}
