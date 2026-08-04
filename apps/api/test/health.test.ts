import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { type HealthStatus } from '@brewcult/shared-types';
import { buildApp } from '../src/app.js';

describe('health endpoints', () => {
  let app: FastifyInstance;

  beforeAll(() => {
    app = buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /healthz returns 200 with an ok HealthStatus', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');

    const body = res.json<HealthStatus>();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('api');
    expect(body.uptime_s).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it('GET /readyz returns 200 with an ok HealthStatus', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' });

    expect(res.statusCode).toBe(200);
    expect(res.json<HealthStatus>().status).toBe('ok');
  });
});
