import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DeliveryJob } from '../../src/domain/delivery/delivery-job.js';
import { Payment } from '../../src/domain/payment/payment.js';
import { PostgresDeliveryJobRepository } from '../../src/infrastructure/persistence/postgres/postgres-delivery-job-repository.js';
import { PostgresPaymentRepository } from '../../src/infrastructure/persistence/postgres/postgres-payment-repository.js';
import { createPostgresPool } from '../../src/infrastructure/persistence/postgres/postgres-client.js';
import { migrate } from '../../src/infrastructure/persistence/postgres/migrate.js';
import { DeterministicPaymentGateway } from '../../src/infrastructure/payments/deterministic-payment-gateway.js';
import {
  ConfirmPayment,
  CreatePayment,
  FailPayment,
  InitiatePayment,
} from '../../src/application/payment/payment-use-cases.js';
import {
  ConflictError,
  PaymentAlreadyExistsError,
  PaymentConcurrencyConflictError,
} from '../../src/shared/errors.js';

const integration = describe.skipIf(!process.env.DATABASE_URL);
const customer = { userId: 'payment-customer', roles: ['CUSTOMER'] as const };
const admin = { userId: 'payment-admin', roles: ['ADMIN'] as const };

function delivery(id: string) {
  return DeliveryJob.create({
    id,
    requesterId: customer.userId,
    pickup: { address: 'Pickup', latitude: 6.6, longitude: 3.35 },
    dropoff: { address: 'Dropoff', latitude: 6.4, longitude: 3.42 },
    deliveryType: 'PARCEL',
  });
}

integration('PostgreSQL payment persistence', () => {
  let pool: Pool;
  let deliveries: PostgresDeliveryJobRepository;
  let payments: PostgresPaymentRepository;

  beforeAll(async () => {
    pool = createPostgresPool();
    await migrate(pool);
    deliveries = new PostgresDeliveryJobRepository(pool);
    payments = new PostgresPaymentRepository(pool);
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
    await pool.end();
  });

  async function createDelivery(id: string): Promise<void> {
    await deliveries.save(delivery(id), 0);
  }

  it('persists and rehydrates a payment across repository instances', async () => {
    await createDelivery('payment-delivery-1');
    const create = new CreatePayment(deliveries, payments);
    const created = await create.execute(customer, 'payment-1', 'payment-delivery-1', 250050, 'NGN', 'create-key-1');
    const freshRepository = new PostgresPaymentRepository(pool);
    const retrieved = await freshRepository.getById('payment-1');

    expect(created).toMatchObject({ amountMinor: 250050, currency: 'NGN', status: 'PENDING', version: 0 });
    expect(retrieved?.snapshot()).toMatchObject({
      id: 'payment-1',
      deliveryJobId: 'payment-delivery-1',
      amountMinor: 250050,
      currency: 'NGN',
      status: 'PENDING',
      version: 0,
    });
  });

  it('persists attempts and payment lifecycle transitions', async () => {
    await createDelivery('payment-delivery-2');
    const create = new CreatePayment(deliveries, payments);
    const initiate = new InitiatePayment(deliveries, payments, new DeterministicPaymentGateway());
    const confirm = new ConfirmPayment(deliveries, payments);
    await create.execute(customer, 'payment-2', 'payment-delivery-2', 100, 'NGN', 'create-key-2');

    const initiated = await initiate.execute(customer, 'payment-2', 'initiate-key-2');
    const confirmed = await confirm.execute(customer, 'payment-2', 'confirm-key-2', initiated.attempt.id);
    const persisted = await payments.getById('payment-2');

    expect(initiated.attempt.providerReference).toBe('internal-test-payment-2-initiate-1');
    expect(confirmed.payment).toMatchObject({ status: 'SUCCEEDED', version: 2 });
    expect(persisted?.snapshot().status).toBe('SUCCEEDED');
    expect((await payments.getAttemptById(initiated.attempt.id))?.snapshot().status).toBe('PROCESSING');
  });

  it('handles idempotent creation and initiation without duplicate rows', async () => {
    await createDelivery('payment-delivery-3');
    const create = new CreatePayment(deliveries, payments);
    const initiate = new InitiatePayment(deliveries, payments, new DeterministicPaymentGateway());
    const first = await create.execute(customer, 'payment-3', 'payment-delivery-3', 100, 'NGN', 'same-key');
    const repeatedCreate = await create.execute(customer, 'different-payment', 'payment-delivery-3', 999, 'USD', 'same-key');
    const firstInitiation = await initiate.execute(customer, 'payment-3', 'init-key');
    const repeatedInitiation = await initiate.execute(customer, 'payment-3', 'init-key');
    const count = await pool.query('SELECT count(*)::int AS count FROM payment_attempts WHERE payment_id = $1', ['payment-3']);

    expect(repeatedCreate).toEqual(first);
    expect(repeatedInitiation).toEqual(firstInitiation);
    expect(count.rows[0].count).toBe(1);
  });

  it('supports failure retry and cancellation', async () => {
    await createDelivery('payment-delivery-4');
    const create = new CreatePayment(deliveries, payments);
    const initiate = new InitiatePayment(deliveries, payments, new DeterministicPaymentGateway());
    const fail = new FailPayment(deliveries, payments);
    const confirm = new ConfirmPayment(deliveries, payments);
    await create.execute(customer, 'payment-4', 'payment-delivery-4', 100, 'NGN', 'create-key-4');
    const firstAttempt = await initiate.execute(customer, 'payment-4', 'initiate-key-4');
    await fail.execute(customer, 'payment-4', 'fail-key-4', firstAttempt.attempt.id);
    const secondAttempt = await initiate.execute(customer, 'payment-4', 'initiate-key-4b');
    await confirm.execute(admin, 'payment-4', 'confirm-key-4', secondAttempt.attempt.id);

    expect((await payments.getById('payment-4'))?.snapshot().status).toBe('SUCCEEDED');
  });

  it('allows exactly one concurrent terminal transition', async () => {
    await createDelivery('payment-delivery-5');
    const create = new CreatePayment(deliveries, payments);
    const initiate = new InitiatePayment(deliveries, payments, new DeterministicPaymentGateway());
    const confirm = new ConfirmPayment(deliveries, payments);
    const fail = new FailPayment(deliveries, payments);
    await create.execute(customer, 'payment-5', 'payment-delivery-5', 100, 'NGN', 'create-key-5');
    const initiated = await initiate.execute(customer, 'payment-5', 'initiate-key-5');

    const results = await Promise.allSettled([
      confirm.execute(customer, 'payment-5', 'confirm-key-5', initiated.attempt.id),
      fail.execute(customer, 'payment-5', 'fail-key-5', initiated.attempt.id),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const failure = results.find(result => result.status === 'rejected');
    expect(failure && [PaymentConcurrencyConflictError, ConflictError].some(type => failure.reason instanceof type)).toBe(true);
    expect(['SUCCEEDED', 'FAILED']).toContain((await payments.getById('payment-5'))?.snapshot().status);
  });

  it('rejects duplicate obligations and invalid foreign keys without partial state', async () => {
    await createDelivery('payment-delivery-6');
    const create = new CreatePayment(deliveries, payments);
    await create.execute(customer, 'payment-6', 'payment-delivery-6', 100, 'NGN', 'create-key-6');

    await expect(create.execute(customer, 'payment-7', 'payment-delivery-6', 100, 'NGN', 'create-key-7'))
      .rejects.toBeInstanceOf(PaymentAlreadyExistsError);
    await expect(payments.saveNew(Payment.create('payment-8', 'missing-delivery', 100, 'NGN'), 'create-key-8'))
      .rejects.toThrow();
    expect((await payments.getById('payment-8'))).toBeNull();
  });
});

void admin;
