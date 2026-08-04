import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AuthorizationError } from './policy.js';
import { isProduction } from './env.js';

/** Application error with an HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (message: string, details?: unknown): ApiError =>
  new ApiError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Authentication required'): ApiError =>
  new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'Not permitted'): ApiError =>
  new ApiError(403, 'forbidden', message);
export const notFound = (message = 'Not found'): ApiError =>
  new ApiError(404, 'not_found', message);
export const conflict = (message: string, details?: unknown): ApiError =>
  new ApiError(409, 'conflict', message, details);
export const tooManyRequests = (message = 'Too many requests'): ApiError =>
  new ApiError(429, 'rate_limited', message);

/**
 * Shared error handler. Two invariants:
 *  - AuthorizationError never leaks whether the resource exists (EF §3.2).
 *  - 5xx responses never echo internals to the client in production.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: Error, request: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof AuthorizationError) {
      request.log.info(
        { resourceType: err.resourceType, action: err.action, userId: (request as { actor?: { userId: string | null } }).actor?.userId ?? null },
        'authorization denied',
      );
      return reply.status(err.statusCode).send({
        error: err.statusCode === 401 ? 'unauthorized' : 'forbidden',
        message: err.statusCode === 401 ? 'Authentication required' : 'Not permitted',
      });
    }

    if (err instanceof ApiError) {
      if (err.statusCode >= 500) request.log.error({ err }, 'api error');
      return reply.status(err.statusCode).send({
        error: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      });
    }

    const statusCode = (err as { statusCode?: number }).statusCode;
    if (typeof statusCode === 'number' && statusCode < 500) {
      return reply.status(statusCode).send({ error: 'bad_request', message: err.message });
    }

    request.log.error({ err }, 'unhandled error');
    return reply.status(500).send({
      error: 'internal_error',
      message: isProduction() ? 'Internal server error' : err.message,
    });
  });
}
