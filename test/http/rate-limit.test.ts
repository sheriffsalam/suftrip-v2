import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { request as httpRequest } from 'node:http';

import { DeliveryService } from '../../src/application/delivery/delivery-service.js';
import { InMemoryDeliveryJobRepository } from '../../src/application/delivery/in-memory-delivery-job-repository.js';
import { SignedBearerTokenAuthenticator } from '../../src/infrastructure/auth/signed-bearer-token-authenticator.js';
import { InMemoryRateLimiter } from '../../src/infrastructure/rate-limit/in-memory-rate-limiter.js';
import { createHttpServer } from '../../src/http/server.js';

describe('HTTP rate-limit boundary', () => {
  let server: ReturnType<typeof createHttpServer> | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>(resolve => server?.close(() => resolve()));
    server = undefined;
  });

  it('returns 429 with rate-limit metadata when the API window is exhausted', async () => {
    const authenticator = new SignedBearerTokenAuthenticator('phase-ten-rate-limit-test-secret-that-is-at-least-32-characters');
    const token = authenticator.issue({ userId: 'requester-1', roles: ['CUSTOMER'] });
    server = createHttpServer(
      new DeliveryService(new InMemoryDeliveryJobRepository()),
      authenticator,
      undefined,
      undefined,
      undefined,
      undefined,
      new InMemoryRateLimiter(1, 60_000),
    );

    await new Promise<void>((resolve, reject) => {
      server?.listen(0, () => resolve());
      server?.once('error', reject);
    });
    const port = (server.address() as AddressInfo).port;

    const request = (path: string) => new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
      const req = httpRequest({ port, method: 'GET', path, headers: { authorization: `Bearer ${token}` } }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.once('error', reject);
      req.end();
    });

    const first = await request('/api/v1/delivery-jobs/missing');
    expect(first.status).toBe(404);
    expect(first.headers['x-ratelimit-limit']).toBe('1');
    expect(first.headers['x-ratelimit-remaining']).toBe('0');

    const second = await request('/api/v1/delivery-jobs/missing');
    expect(second.status).toBe(429);
    expect(second.headers['x-ratelimit-limit']).toBe('1');
    expect(second.headers['x-ratelimit-remaining']).toBe('0');
    expect(second.headers['retry-after']).toBeDefined();
    expect(JSON.parse(second.body)).toMatchObject({ error: { code: 'RATE_LIMIT_EXCEEDED' } });
  });

  it('does not rate-limit the public health endpoint', async () => {
    const authenticator = new SignedBearerTokenAuthenticator('phase-ten-rate-limit-test-secret-that-is-at-least-32-characters');
    server = createHttpServer(
      new DeliveryService(new InMemoryDeliveryJobRepository()),
      authenticator,
      undefined,
      undefined,
      undefined,
      undefined,
      new InMemoryRateLimiter(1, 60_000),
    );

    await new Promise<void>((resolve, reject) => {
      server?.listen(0, () => resolve());
      server?.once('error', reject);
    });
    const port = (server.address() as AddressInfo).port;

    const statuses = await Promise.all([1, 2, 3].map(() => new Promise<number>((resolve, reject) => {
      const req = httpRequest({ port, method: 'GET', path: '/health' }, response => {
        response.resume();
        response.once('end', () => resolve(response.statusCode ?? 0));
      });
      req.once('error', reject);
      req.end();
    })));

    expect(statuses).toEqual([200, 200, 200]);
  });
});
