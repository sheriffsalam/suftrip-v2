import type {
  Payment,
  PaymentAttempt,
  PaymentAttemptSnapshot,
} from '../../domain/payment/payment.js';

export interface PaymentRepository {
  getById(id: string): Promise<Payment | null>;
  getByDeliveryJobId(deliveryJobId: string): Promise<Payment | null>;
  getAttemptById(id: string): Promise<PaymentAttempt | null>;
  getLatestAttempt(paymentId: string): Promise<PaymentAttempt | null>;
  findAttemptByIdempotencyKey(
    paymentId: string,
    operation: PaymentAttemptSnapshot['operation'],
    idempotencyKey: string,
  ): Promise<PaymentAttempt | null>;
  findByCreationIdempotencyKey(idempotencyKey: string): Promise<Payment | null>;
  saveNew(payment: Payment, idempotencyKey: string): Promise<void>;
  saveOperation(
    payment: Payment,
    expectedVersion: number,
    attempt: PaymentAttempt,
  ): Promise<void>;
}

export type PaymentRecord = ReturnType<Payment['snapshot']>;
export type PaymentAttemptRecord = PaymentAttemptSnapshot;
