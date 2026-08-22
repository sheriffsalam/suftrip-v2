import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { DeliveryService } from '../../src/application/delivery/delivery-service.js';
import { InMemoryDeliveryJobRepository } from '../../src/application/delivery/in-memory-delivery-job-repository.js';
import { SignedBearerTokenAuthenticator } from '../../src/infrastructure/auth/signed-bearer-token-authenticator.js';
import { createHttpServer } from '../../src/http/server.js';
import { CreateNotification, GetNotification, SendNotification, RetryNotification, CancelNotification } from '../../src/application/notification/notification-use-cases.js';
import { InMemoryNotificationRepository } from '../../src/application/notification/in-memory-notification-repository.js';
import { DeterministicNotificationSender } from '../../src/infrastructure/notifications/deterministic-notification-sender.js';

const authenticator = new SignedBearerTokenAuthenticator(
  'phase-five-test-secret-that-is-at-least-32-characters',
);
const customerToken = authenticator.issue({
  userId: 'requester-1',
  roles: ['CUSTOMER'],
});
const otherCustomerToken = authenticator.issue({
  userId: 'requester-2',
  roles: ['CUSTOMER'],
});
const adminToken = authenticator.issue({
  userId: 'admin-1',
  roles: ['ADMIN'],
});

const createBody = (id = 'job-1') => ({
  id,
  requesterId: 'requester-1',
  pickup: {
    address: 'Ikeja, Lagos',
    latitude: 6.6018,
    longitude: 3.3515,
  },
  dropoff: {
    address: 'Victoria Island, Lagos',
    latitude: 6.4281,
    longitude: 3.4219,
  },
  deliveryType: 'PARCEL',
});

type TestResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

function sendRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  authenticated = true,
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined
      ? undefined
      : typeof body === 'string'
        ? body
        : JSON.stringify(body);
    const request = httpRequest({
      port,
      method,
      path,
      headers: {
        ...(authenticated ? { authorization: `Bearer ${customerToken}` } : {}),
        ...(payload ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: text ? JSON.parse(text) : undefined,
        });
      });
    });

    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

describe('HTTP API', () => {
  let server: ReturnType<typeof createHttpServer>;
  let port: number;

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  });

  async function startServer(notificationDependencies?: Parameters<typeof createHttpServer>[4]): Promise<void> {
    server = createHttpServer(
      new DeliveryService(new InMemoryDeliveryJobRepository()),
      authenticator,
      undefined,
      undefined,
      notificationDependencies,
    );
    await new Promise<void>((resolve, reject) => {
      server.listen(0, () => resolve());
      server.once('error', reject);
    });
    port = (server.address() as AddressInfo).port;
  }

  it('creates and retrieves a delivery job through the versioned API', async () => {
    await startServer();

    const created = await sendRequest(
      port,
      'POST',
      '/api/v1/delivery-jobs',
      createBody(),
      { 'x-request-id': 'request-123' },
    );

    expect(created.statusCode).toBe(201);
    expect(created.headers['x-request-id']).toBe('request-123');
    expect(created.body).toMatchObject({ id: 'job-1', status: 'DRAFT' });

    const retrieved = await sendRequest(
      port,
      'GET',
      '/api/v1/delivery-jobs/job-1',
    );

    expect(retrieved.statusCode).toBe(200);
    expect(retrieved.body).toMatchObject({ id: 'job-1', version: 0 });
  });

  it('routes notification operations through the canonical API server', async () => {
    const repository = new InMemoryNotificationRepository();
    const sender = new DeterministicNotificationSender();
    await startServer({
      create: new CreateNotification(repository),
      get: new GetNotification(repository),
      send: new SendNotification(repository, sender),
      retry: new RetryNotification(repository, sender),
      cancel: new CancelNotification(repository),
    });

    const created = await sendRequest(
      port,
      'POST',
      '/api/v1/notifications',
      {
        id: 'notification-http-1',
        recipientId: 'requester-1',
        channel: 'IN_APP',
        templateKey: 'delivery.status.updated',
        payload: { deliveryId: 'job-1', message: 'Your delivery is on the way' },
      },
      { 'idempotency-key': 'notification-create-1' },
    );

    expect(created.statusCode).toBe(201);
    expect(created.body).toMatchObject({ id: 'notification-http-1', status: 'QUEUED' });

    const sent = await sendRequest(
      port,
      'POST',
      '/api/v1/notifications/notification-http-1/send',
      undefined,
      { 'idempotency-key': 'notification-send-1' },
    );

    expect(sent.statusCode).toBe(200);
    expect(sent.body).toMatchObject({
      notification: { id: 'notification-http-1', status: 'SENT' },
      attempt: { status: 'SENT' },
    });

    const retrieved = await sendRequest(
      port,
      'GET',
      '/api/v1/notifications/notification-http-1',
    );

    expect(retrieved.statusCode).toBe(200);
    expect(retrieved.body).toMatchObject({ id: 'notification-http-1', status: 'SENT' });
  });

  it('requires valid bearer authentication for delivery endpoints', async () => {
    await startServer();

    const missing = await sendRequest(
      port,
      'GET',
      '/api/v1/delivery-jobs/job-1',
      undefined,
      {},
      false,
    );
    expect(missing.statusCode).toBe(401);
    expect(missing.body).toMatchObject({ error: { code: 'AUTHENTICATION_ERROR' } });

    const malformed = await sendRequest(
      port,
      'GET',
      '/api/v1/delivery-jobs/job-1',
      undefined,
      { authorization: 'Basic credentials' },
    );
    expect(malformed.statusCode).toBe(401);

    const invalid = await sendRequest(
      port,
      'GET',
      '/api/v1/delivery-jobs/job-1',
      undefined,
      { authorization: 'Bearer invalid-token' },
    );
    expect(invalid.statusCode).toBe(401);

    const expiredToken = authenticator.issue(
      { userId: 'requester-1', roles: ['CUSTOMER'] },
      Math.floor(Date.now() / 1000) - 1,
    );
    const expired = await sendRequest(
      port,
      'GET',
      '/api/v1/delivery-jobs/job-1',
      undefined,
      { authorization: `Bearer ${expiredToken}` },
    );
    expect(expired.statusCode).toBe(401);
  });

  it('keeps health public and applies security headers', async () => {
    await startServer();

    const result = await sendRequest(port, 'GET', '/health', undefined, {}, false);

    expect(result.statusCode).toBe(200);
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(result.headers['referrer-policy']).toBe('no-referrer');
    expect(result.headers['cache-control']).toBe('no-store');
  });

  it('returns typed validation errors for malformed JSON', async () => {
    await startServer();

    const result = await sendRequest(
      port,
      'POST',
      '/api/v1/delivery-jobs',
      '{bad json',
      { 'content-type': 'application/json' },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
  });

  it('maps not found, invalid transition, and stale writes', async () => {
    await startServer();

    const missing = await sendRequest(
      port,
      'GET',
      '/api/v1/delivery-jobs/missing',
    );
    expect(missing.statusCode).toBe(404);
    expect(missing.body).toMatchObject({
      error: { code: 'DELIVERY_JOB_NOT_FOUND' },
    });

    await sendRequest(port, 'POST', '/api/v1/delivery-jobs', createBody());

    const invalidTransition = await sendRequest(
      port,
      'PATCH',
      '/api/v1/delivery-jobs/job-1/status',
      { expectedVersion: 0, nextStatus: 'DELIVERED' },
    );
    expect(invalidTransition.statusCode).toBe(422);
    expect(invalidTransition.body).toMatchObject({
      error: { code: 'INVALID_TRANSITION' },
    });

    await sendRequest(
      port,
      'PATCH',
      '/api/v1/delivery-jobs/job-1/status',
      { expectedVersion: 0, nextStatus: 'REQUESTED' },
    );

    const conflict = await sendRequest(
      port,
      'PATCH',
      '/api/v1/delivery-jobs/job-1/status',
      { expectedVersion: 0, nextStatus: 'QUOTING' },
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.body).toMatchObject({ error: { code: 'CONFLICT' } });
  });

  it('rejects duplicate creates with a conflict response', async () => {
    await startServer();

    await sendRequest(port, 'POST', '/api/v1/delivery-jobs', createBody());
    const duplicate = await sendRequest(
      port,
      'POST',
      '/api/v1/delivery-jobs',
      createBody(),
    );

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.body).toMatchObject({ error: { code: 'CONFLICT' } });
  });

  it('uses authenticated identity instead of a spoofed requesterId', async () => {
    await startServer();

    const result = await sendRequest(
      port,
      'POST',
      '/api/v1/delivery-jobs',
      { ...createBody('spoofed-job'), requesterId: 'requester-2' },
    );

    expect(result.statusCode).toBe(201);
    expect(result.body).toMatchObject({
      id: 'spoofed-job',
      requesterId: 'requester-1',
    });
  });

  it('enforces object-level ownership while allowing admins across users', async () => {
    await startServer();

    await sendRequest(port, 'POST', '/api/v1/delivery-jobs', createBody('owned-job'));

    const otherCustomer = await sendRequest(
      port,
      'GET',
      '/api/v1/delivery-jobs/owned-job',
      undefined,
      { authorization: `Bearer ${otherCustomerToken}` },
    );
    expect(otherCustomer.statusCode).toBe(403);
    expect(otherCustomer.body).toMatchObject({
      error: { code: 'AUTHORIZATION_ERROR' },
    });

    const admin = await sendRequest(
      port,
      'GET',
      '/api/v1/delivery-jobs/owned-job',
      undefined,
      { authorization: `Bearer ${adminToken}` },
    );
    expect(admin.statusCode).toBe(200);
  });

  it('protects status changes with object-level authorization', async () => {
    await startServer();

    await sendRequest(port, 'POST', '/api/v1/delivery-jobs', createBody('status-job'));

    const result = await sendRequest(
      port,
      'PATCH',
      '/api/v1/delivery-jobs/status-job/status',
      { expectedVersion: 0, nextStatus: 'REQUESTED' },
      { authorization: `Bearer ${otherCustomerToken}` },
    );

    expect(result.statusCode).toBe(403);
  });
});