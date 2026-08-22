import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { request as httpRequest } from 'node:http';

import type { Logger, LogLevel } from '../../src/application/observability/logger.js';
import { DeliveryService } from '../../src/application/delivery/delivery-service.js';
import { InMemoryDeliveryJobRepository } from '../../src/application/delivery/in-memory-delivery-job-repository.js';
import { SignedBearerTokenAuthenticator } from '../../src/infrastructure/auth/signed-bearer-token-authenticator.js';
import { createHttpServer } from '../../src/http/server.js';

type Entry = { level: LogLevel; message: string; context?: Record<string, string | number | boolean | null> };

class TestLogger implements Logger {
  readonly entries: Entry[] = [];

  log(level: LogLevel, message: string, context?: Entry['context']): void {
    this.entries.push({ level, message, context });
  }

  info(message: string, context?: Entry['context']): void { this.log('INFO', message, context); }
  warn(message: string, context?: Entry['context']): void { this.log('WARN', message, context); }
  error(message: string, context?: Entry['context']): void { this.log('ERROR', message, context); }
}

describe('HTTP observability boundary', () => {
  let server: ReturnType<typeof createHttpServer> | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>(resolve => server?.close(() => resolve()));
    server = undefined;
  });

  it('logs completed requests with request identity and timing but no credentials', async () => {
    const authenticator = new SignedBearerTokenAuthenticator('phase-five-test-secret-that-is-at-least-32-characters');
    const token = authenticator.issue({ userId: 'requester-1', roles: ['CUSTOMER'] });
    const logger = new TestLogger();
    server = createHttpServer(new DeliveryService(new InMemoryDeliveryJobRepository()), authenticator, undefined, undefined, undefined, logger);

    await new Promise<void>((resolve, reject) => {
      server?.listen(0, () => resolve());
      server?.once('error', reject);
    });
    const port = (server.address() as AddressInfo).port;

    await new Promise<void>((resolve, reject) => {
      const request = httpRequest({
        port,
        method: 'GET',
        path: '/health',
        headers: {
          authorization: `Bearer ${token}`,
          'x-request-id': 'observability-test-request',
        },
      }, response => {
        response.resume();
        response.once('end', resolve);
      });
      request.once('error', reject);
      request.end();
    });

    const completed = logger.entries.find(entry => entry.message === 'http.request.completed');
    expect(completed).toBeDefined();
    expect(completed?.level).toBe('INFO');
    expect(completed?.context).toMatchObject({
      requestId: 'observability-test-request',
      method: 'GET',
      path: '/health',
      statusCode: 200,
    });
    expect(completed?.context?.durationMs).toEqual(expect.any(Number));
    expect(JSON.stringify(logger.entries)).not.toContain(token);
    expect(JSON.stringify(logger.entries)).not.toContain('authorization');
  });
});
