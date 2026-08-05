/**
 * @brewcult/shared-types — types shared across BrewCult apps.
 *
 * Types-only package: `exports` points at TypeScript source, so consumers
 * (tsc, tsx, vitest, Next) resolve it without a build step. Runtime code must
 * import it with `import type` — nothing here exists at runtime.
 */

/** Role-based deployables (EF §7.2): one codebase, four entrypoints. */
export type ServiceName = 'api' | 'web' | 'worker' | 'scheduler';

/**
 * Shape returned by the health/readiness endpoints (GET /healthz, GET /readyz)
 * and used by container healthchecks (deployment_guide §5.2, backlog F-18).
 */
export interface HealthStatus {
  status: 'ok' | 'degraded';
  service: ServiceName;
  /** Process uptime, whole seconds. */
  uptime_s: number;
  /** ISO-8601 timestamp of the check. */
  timestamp: string;
}

export * from './brewing.js';
