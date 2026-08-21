import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { DeliveryService } from '../../src/application/delivery/delivery-service.js';
import { InMemoryDeliveryJobRepository } from '../../src/application/delivery/in-memory-delivery-job-repository.js';
import { InMemoryPaymentRepository } from '../../src/application/payment/in-memory-payment-repository.js';
import {
  CancelPayment,
  ConfirmPayment,
  CreatePayment,
  FailPayment,
  GetPayment,
  InitiatePayment,
} from '../../src/application/payment/payment-use-cases.js';
import { DeterministicPaymentGateway } from '../../src/infrastructure/payments/deterministic-payment-gateway.js';
import { SignedBearerTokenAuthenticator } from '../../src/infrastructure/auth/signed-bearer-token-authenticator.js';
import { createHttpServer, type PaymentHttpDependencies } from '../../src/http/server.js';

const authenticator = new SignedBearerTokenAuthenticator('phase-seven-http-secret-that-is-at-least-32-characters');
const customer = { userId: 'payment-http-customer', roles: ['CUSTOMER'] as const };
const otherCustomer = { userId: 'payment-http-other', roles: ['CUSTOMER'] as const };

function requestJson(port: number, method: string, path: string, token: string, body?: unknown, idempotencyKey?: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = httpRequest({
      port,
      method,
      path,
      headers: {
        authorization: `Bearer ${token}`,
        ...(payload ? { 'content-type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

describe('Payment HTTP API', () => {
  let server: ReturnType<typeof createHttpServer>;
  let port: number;

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it('runs an authenticated idempotent payment flow', async () => {
    const deliveries = new InMemoryDeliveryJobRepository();
    const deliveryService = new DeliveryService(deliveries);
    await deliveryService.create(customer, {
      id: 'payment-http-delivery',
      requesterId: 'spoofed',
      pickup: { address: 'Pickup', latitude: 6.6, longitude: 3.35 },
      dropoff: { address: 'Dropoff', latitude: 6.4, longitude: 3.42 },
      deliveryType: 'PARCEL',
    });
    const repository = new InMemoryPaymentRepository();
    const dependencies: PaymentHttpDependencies = {
      create: new CreatePayment(deliveries, repository),
      get: new GetPayment(deliveries, repository),
      initiate: new InitiatePayment(deliveries, repository, new DeterministicPaymentGateway()),
      confirm: new ConfirmPayment(deliveries, repository),
      fail: new FailPayment(deliveries, repository),
      cancel: new CancelPayment(deliveries, repository),
    };
    server = createHttpServer(deliveryService, authenticator, undefined, dependencies);
    await new Promise<void>((resolve, reject) => {
      server.listen(0, () => resolve());
      server.once('error', reject);
    });
    port = (server.address() as AddressInfo).port;
    const customerToken = authenticator.issue(customer);
    const otherToken = authenticator.issue(otherCustomer);

    const missingKey = await requestJson(port, 'POST', '/api/v1/delivery-jobs/payment-http-delivery/payments', customerToken, { id: 'payment-http-1', amountMinor: 1250, currency: 'NGN' });
    expect(missingKey.status).toBe(400);

    const created = await requestJson(port, 'POST', '/api/v1/delivery-jobs/payment-http-delivery/payments', customerToken, { id: 'payment-http-1', requesterId: 'spoofed', amountMinor: 1250, currency: 'NGN' }, 'create-payment-1');
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: 'payment-http-1', status: 'PENDING', amountMinor: 1250 });

    const initiated = await requestJson(port, 'POST', '/api/v1/payments/payment-http-1/initiate', customerToken, {}, 'initiate-payment-1');
    expect(initiated.status).toBe(200);
    expect(initiated.body).toMatchObject({ payment: { status: 'PROCESSING' }, attempt: { status: 'PROCESSING' } });

    const repeated = await requestJson(port, 'POST', '/api/v1/payments/payment-http-1/initiate', customerToken, {}, 'initiate-payment-1');
    expect(repeated.body).toEqual(initiated.body);

    const confirmed = await requestJson(port, 'POST', '/api/v1/payments/payment-http-1/confirm', customerToken, { attemptId: initiated.body.attempt.id }, 'confirm-payment-1');
    expect(confirmed.body.payment).toMatchObject({ status: 'SUCCEEDED', version: 2 });

    const forbidden = await requestJson(port, 'GET', '/api/v1/payments/payment-http-1', otherToken);
    expect(forbidden.status).toBe(403);
  });
});
