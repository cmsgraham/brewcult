/**
 * Glue between Fastify requests and the module's data layer.
 */
import type { FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { query } from '../../lib/db.js';
import type { SessionContext } from './tokens.js';
import type { Exec } from './types.js';

/** Pool-backed executor (auto-commit). */
export const poolExec: Exec = (text, params) => query(text, params ?? []);

/** Wraps a transaction client in the same minimal interface. */
export const clientExec =
  (client: PoolClient): Exec =>
  (text, params) =>
    client.query(text, (params ?? []) as unknown[]);

/** Device metadata recorded with sessions and login attempts. */
export function requestContext(request: FastifyRequest): SessionContext {
  return {
    ip: request.ip ?? null,
    userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
  };
}
