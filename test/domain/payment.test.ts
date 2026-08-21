import { describe, expect, it } from 'vitest';

import {
  InvalidPaymentTransitionError,
  Payment,
  PaymentAttempt,
} from '../../src/domain/payment/payment.js';

describe('Payment', () => {
  it('creates with validated minor-unit money', () => {
    const payment = Payment.create('payment-1', 'delivery-1', 250050, 'NGN');
    expect(payment.snapshot()).toMatchObject({
      id: 'payment-1',
      deliveryJobId: 'delivery-1',
      amountMinor: 250050,
      currency: 'NGN',
      status: 'PENDING',
      version: 0,
    });
  });

  it('rejects invalid money', () => {
    expect(() => Payment.create('payment-1', 'delivery-1', 0, 'NGN')).toThrow();
    expect(() => Payment.create('payment-1', 'delivery-1', 1.5, 'NGN')).toThrow();
    expect(() => Payment.create('payment-1', 'delivery-1', 1, 'usd')).toThrow();
    expect(() => Payment.create('payment-1', 'delivery-1', Number.MAX_SAFE_INTEGER + 1, 'NGN')).toThrow();
  });

  it('supports processing, success, failure retry, and cancellation', () => {
    const payment = Payment.create('payment-1', 'delivery-1', 100, 'NGN');
    payment.beginProcessing('attempt-1');
    payment.fail('attempt-1');
    payment.beginProcessing('attempt-2');
    payment.succeed('attempt-2');

    expect(payment.snapshot()).toMatchObject({ status: 'SUCCEEDED', version: 4 });
    expect(() => payment.cancel()).toThrow(InvalidPaymentTransitionError);
  });

  it('rejects invalid and terminal transitions', () => {
    const payment = Payment.create('payment-1', 'delivery-1', 100, 'NGN');
    expect(() => payment.succeed('attempt-1')).toThrow(InvalidPaymentTransitionError);
    payment.cancel();
    expect(() => payment.beginProcessing('attempt-1')).toThrow(InvalidPaymentTransitionError);
  });

  it('creates payment attempts separately', () => {
    const attempt = PaymentAttempt.create('attempt-1', 'payment-1', 'key-1', 'INITIATE');
    expect(attempt.snapshot()).toMatchObject({
      id: 'attempt-1',
      paymentId: 'payment-1',
      status: 'PROCESSING',
      idempotencyKey: 'key-1',
      operation: 'INITIATE',
      providerReference: null,
    });
    expect(attempt.withStatus('SUCCEEDED').snapshot().status).toBe('SUCCEEDED');
  });

  it('emits payment events for domain operations', () => {
    const payment = Payment.create('payment-1', 'delivery-1', 100, 'NGN');
    payment.beginProcessing('attempt-1');
    payment.succeed('attempt-1');
    expect(payment.pullEvents()).toEqual([
      { type: 'PaymentCreated', paymentId: 'payment-1', deliveryJobId: 'delivery-1' },
      { type: 'PaymentInitiated', paymentId: 'payment-1', attemptId: 'attempt-1' },
      { type: 'PaymentSucceeded', paymentId: 'payment-1', attemptId: 'attempt-1' },
    ]);
  });
});
