import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DeliveryService } from '../../src/application/delivery/delivery-service.js';
import { CreatePayment, ConfirmPayment, CreatePayment as CreatePaymentUseCase, FailPayment, GetPayment, InitiatePayment, CancelPayment } from '../../src/application/payment/payment-use-cases.js';
import type { PaymentHttpDependencies } from '../../src/http/server.js';
import { createHttpServer } from '../../src/http/server.js';
import { PostgresDeliveryJobRepository } from '../../src/infrastructure/persistence/postgres/postgres-delivery-job-repository.js';
import { PostgresPaymentRepository } from '../../src/infrastructure/persistence/postgres/postgres-payment-repository.js';
import { createPostgresPool } from '../../src/infrastructure/persistence/postgres/postgres-client.js';
import { migrate } from '../../src/infrastructure/persistence/postgres/migrate.js';
import { SignedBearerTokenAuthenticator } from '../../src/infrastructure/auth/signed-bearer-token-authenticator.js';

const integration = describe.skipIf(!process.env.DATABASE_URL);
const authenticator = new SignedBearerTokenAuthenticator('phase-seven-http-integration-secret-at-least-32');
const customer = { userId: 'payment-http-integration-customer', roles: ['CUSTOMER'] as const };

function requestJson(port: number, method: string, path: string, token: string, body: unknown, idempotencyKey?: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = httpRequest({
      port,
      method,
      path,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    request.on('error', reject);
    request.write(payload);
    request.end();
  });
}

integration('PostgreSQL payment HTTP flow', () => {
  let pool: Pool;
  let server: ReturnType<typeof createHttpServer>;
  let port: number;

  beforeAll(async () => {
    pool = createPostgresPool();
    await migrate(pool);
    const deliveries = new PostgresDeliveryJobRepository(pool);
    const payments = new PostgresPaymentRepository(pool);
    const paymentDependencies: PaymentHttpDependencies = {
      create: new CreatePaymentUseCase(deliveries, payments),
      get: new GetPayment(deliveries, payments),
      initiate: new InitiatePayment(deliveries, payments, { initializePayment: async (_payment, attemptId) => `http-internal-${attemptId}` }),
      confirm: new ConfirmPayment(deliveries, payments),
      fail: new FailPayment(deliveries, payments),
      cancel: new CancelPayment(deliveries, payments),
    };
    server = createHttpServer(new DeliveryService(deliveries), authenticator, undefined, paymentDependencies);
    await new Promise<void>((resolve, reject) => {
      server.listen(0, () => resolve());
      server.once('error', reject);
    });
    port = (server.address() as AddressInfo).port;
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM payment_attempts');
    await pool.query('DELETE FROM payment_creation_keys');
    await pool.query('DELETE FROM payments');
    await pool.query('DELETE FROM dispatch_jobs');
    await pool.query('DELETE FROM providers');
    await pool.query('DELETE FROM delivery_jobs');
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end();
  });

  it('persists authenticated create, initiate, and confirm requests in PostgreSQL', async () => {
    const token = authenticator.issue(customer);
    const delivery = await requestJson(port, 'POST', '/api/v1/delivery-jobs', token, {
      id: 'payment-http-integration-delivery',
      requesterId: 'spoofed',
      pickup: { address: 'Pickup', latitude: 6.6, longitude: 3.35 },
      dropoff: { address: 'Dropoff', latitude: 6.4, longitude: 3.42 },
      deliveryType: 'DOCUMENT',
    });
    expect(delivery.status).toBe(201);

    const created = await requestJson(port, 'POST', '/api/v1/delivery-jobs/payment-http-integration-delivery/payments', token, {
      id: 'payment-http-integration-payment',
      requesterId: 'spoofed',
      amountMinor: 9900,
      currency: 'NGN',
    }, 'http-create-payment');
    expect(created.status).toBe(201);

    const initiated = await requestJson(port, 'POST', '/api/v1/payments/payment-http-integration-payment/initiate', token, {}, 'http-initiate-payment');
    expect(initiated.status).toBe(200);
    const confirmed = await requestJson(port, 'POST', '/api/v1/payments/payment-http-integration-payment/confirm', token, { attemptId: initiated.body.attempt.id }, 'http-confirm-payment');
    expect(confirmed.body.payment).toMatchObject({ status: 'SUCCEEDED', amountMinor: 9900, currency: 'NGN', version: 2 });

    const row = await pool.query('SELECT d.requester_id, p.status, p.version FROM payments p JOIN delivery_jobs d ON d.id = p.delivery_job_id WHERE p.id = $1', ['payment-http-integration-payment']);
    expect(row.rows[0]).toMatchObject({ requester_id: customer.userId, status: 'SUCCEEDED', version: 2 });
  });
});

void FailPayment;
void CancelPayment;
