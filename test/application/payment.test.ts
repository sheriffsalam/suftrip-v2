import { describe, expect, it } from 'vitest';

import { DeliveryJob } from '../../src/domain/delivery/delivery-job.js';
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
import { AuthorizationError, PaymentAlreadyExistsError } from '../../src/shared/errors.js';

const customer = { userId: 'customer-1', roles: ['CUSTOMER'] as const };
const otherCustomer = { userId: 'customer-2', roles: ['CUSTOMER'] as const };

async function setup() {
  const deliveries = new InMemoryDeliveryJobRepository();
  const deliveryService = new DeliveryService(deliveries);
  await deliveryService.create(customer, {
    id: 'delivery-1',
    requesterId: 'ignored',
    pickup: { address: 'Pickup', latitude: 6.6, longitude: 3.35 },
    dropoff: { address: 'Dropoff', latitude: 6.4, longitude: 3.42 },
    deliveryType: 'PARCEL',
  });
  const payments = new InMemoryPaymentRepository();
  const create = new CreatePayment(deliveries, payments);
  const initiate = new InitiatePayment(deliveries, payments, new DeterministicPaymentGateway());
  return {
    deliveries,
    payments,
    create,
    initiate,
    confirm: new ConfirmPayment(deliveries, payments),
    fail: new FailPayment(deliveries, payments),
    cancel: new CancelPayment(deliveries, payments),
    get: new GetPayment(deliveries, payments),
  };
}

describe('payment application', () => {
  it('creates, initiates, confirms, and retrieves a payment', async () => {
    const { create, initiate, confirm, get } = await setup();
    await create.execute(customer, 'payment-1', 'delivery-1', 250050, 'NGN', 'create-key-1');
    const initiated = await initiate.execute(customer, 'payment-1', 'initiate-key-1');
    expect(initiated.payment).toMatchObject({ status: 'PROCESSING', version: 1 });
    expect(initiated.attempt).toMatchObject({ status: 'PROCESSING', operation: 'INITIATE' });

    const confirmed = await confirm.execute(customer, 'payment-1', 'confirm-key-1', initiated.attempt.id);
    expect(confirmed.payment).toMatchObject({ status: 'SUCCEEDED', version: 2 });
    expect((await get.execute(customer, 'payment-1')).status).toBe('SUCCEEDED');
  });

  it('supports failed payment retry and cancellation', async () => {
    const { create, initiate, fail, cancel } = await setup();
    await create.execute(customer, 'payment-1', 'delivery-1', 100, 'NGN', 'create-key-1');
    await initiate.execute(customer, 'payment-1', 'initiate-key-1');
    const failed = await fail.execute(customer, 'payment-1', 'fail-key-1');
    expect(failed.payment.status).toBe('FAILED');
    const retried = await initiate.execute(customer, 'payment-1', 'initiate-key-2');
    expect(retried.payment.status).toBe('PROCESSING');
    expect((await cancel.execute(customer, 'payment-1', 'cancel-key-1')).payment.status).toBe('CANCELLED');
  });

  it('returns the same result for repeated idempotent operations', async () => {
    const { create, initiate } = await setup();
    await create.execute(customer, 'payment-1', 'delivery-1', 100, 'NGN', 'create-key-1');
    const first = await initiate.execute(customer, 'payment-1', 'initiate-key-1');
    const second = await initiate.execute(customer, 'payment-1', 'initiate-key-1');
    expect(second).toEqual(first);
  });

  it('protects payment ownership and duplicate obligations', async () => {
    const { create, get } = await setup();
    await create.execute(customer, 'payment-1', 'delivery-1', 100, 'NGN', 'create-key-1');
    await expect(get.execute(otherCustomer, 'payment-1')).rejects.toBeInstanceOf(AuthorizationError);
    await expect(create.execute(customer, 'payment-2', 'delivery-1', 100, 'NGN', 'create-key-2')).rejects.toBeInstanceOf(PaymentAlreadyExistsError);
  });

  it('requires an existing delivery and idempotency key', async () => {
    const { create } = await setup();
    await expect(create.execute(customer, 'payment-1', 'missing', 100, 'NGN', 'key')).rejects.toThrow('DeliveryJob not found');
    await expect(create.execute(customer, 'payment-1', 'delivery-1', 100, 'NGN', '')).rejects.toThrow('Idempotency-Key is required');
  });
});

void DeliveryJob;
