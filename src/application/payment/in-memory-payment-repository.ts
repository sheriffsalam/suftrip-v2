import { Payment, PaymentAttempt, type PaymentAttemptSnapshot } from '../../domain/payment/payment.js';
import type { PaymentRepository } from './payment-repository.js';
import {
  ConflictError,
  IdempotencyConflictError,
  PaymentAlreadyExistsError,
  PaymentConcurrencyConflictError,
} from '../../shared/errors.js';

export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly payments = new Map<string, ReturnType<Payment['snapshot']>>();
  private readonly attempts = new Map<string, ReturnType<PaymentAttempt['snapshot']>>();
  private readonly creationKeys = new Map<string, string>();

  async getById(id: string): Promise<Payment | null> {
    const record = this.payments.get(id);
    return record ? Payment.rehydrate(record) : null;
  }

  async getByDeliveryJobId(deliveryJobId: string): Promise<Payment | null> {
    const record = [...this.payments.values()].find(item => item.deliveryJobId === deliveryJobId);
    return record ? Payment.rehydrate(record) : null;
  }

  async getAttemptById(id: string): Promise<PaymentAttempt | null> {
    const record = this.attempts.get(id);
    return record ? PaymentAttempt.rehydrate(record) : null;
  }

  async getLatestAttempt(paymentId: string): Promise<PaymentAttempt | null> {
    const records = [...this.attempts.values()].filter(item => item.paymentId === paymentId);
    const record = records.sort((left, right) => left.createdAt.localeCompare(right.createdAt)).at(-1);
    return record ? PaymentAttempt.rehydrate(record) : null;
  }

  async findAttemptByIdempotencyKey(paymentId: string, operation: PaymentAttemptSnapshot['operation'], idempotencyKey: string): Promise<PaymentAttempt | null> {
    const record = [...this.attempts.values()].find(item => item.paymentId === paymentId && item.operation === operation && item.idempotencyKey === idempotencyKey);
    return record ? PaymentAttempt.rehydrate(record) : null;
  }

  async findByCreationIdempotencyKey(idempotencyKey: string): Promise<Payment | null> {
    const paymentId = this.creationKeys.get(idempotencyKey);
    return paymentId ? this.getById(paymentId) : null;
  }

  async saveNew(payment: Payment, idempotencyKey: string): Promise<void> {
    if (this.payments.has(payment.snapshot().id)) throw new PaymentAlreadyExistsError();
    if (this.creationKeys.has(idempotencyKey)) throw new IdempotencyConflictError();
    this.payments.set(payment.snapshot().id, payment.snapshot());
    this.creationKeys.set(idempotencyKey, payment.snapshot().id);
  }

  async saveOperation(payment: Payment, expectedVersion: number, attempt: PaymentAttempt): Promise<void> {
    const current = this.payments.get(payment.snapshot().id);
    if (!current || current.version !== expectedVersion) throw new PaymentConcurrencyConflictError();
    const duplicate = [...this.attempts.values()].find(item => item.paymentId === attempt.snapshot().paymentId && item.operation === attempt.snapshot().operation && item.idempotencyKey === attempt.snapshot().idempotencyKey);
    if (duplicate) throw new IdempotencyConflictError();
    if (this.attempts.has(attempt.snapshot().id)) throw new ConflictError('Payment attempt already exists');
    this.payments.set(payment.snapshot().id, payment.snapshot());
    this.attempts.set(attempt.snapshot().id, attempt.snapshot());
  }
}
