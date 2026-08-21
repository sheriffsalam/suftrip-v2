import type { AuthenticatedPrincipal } from '../auth/authentication.js';
import { requireDeliveryAccess } from '../auth/authorization.js';
import type { DeliveryJobRepository } from '../delivery/delivery-job-repository.js';
import {
  Payment,
  PaymentAttempt,
  type PaymentAttemptSnapshot,
  type PaymentOperation,
} from '../../domain/payment/payment.js';
import {
  NotFoundError,
  PaymentAlreadyExistsError,
  PaymentOperationConflictError,
  ValidationError,
} from '../../shared/errors.js';
import type { PaymentGateway } from './payment-gateway.js';
import type { PaymentRepository } from './payment-repository.js';

export type PaymentOperationResult = Readonly<{
  payment: ReturnType<Payment['snapshot']>;
  attempt: ReturnType<PaymentAttempt['snapshot']>;
}>;

export class CreatePayment {
  constructor(
    private readonly deliveries: DeliveryJobRepository,
    private readonly payments: PaymentRepository,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    paymentId: string,
    deliveryJobId: string,
    amountMinor: number,
    currency: string,
    idempotencyKey: string,
  ): Promise<ReturnType<Payment['snapshot']>> {
    requireIdempotencyKey(idempotencyKey);
    const delivery = await this.deliveries.getById(deliveryJobId);
    if (!delivery) throw new NotFoundError(`DeliveryJob not found: ${deliveryJobId}`);
    requireDeliveryAccess(principal, delivery.snapshot().requesterId);

    const idempotentPayment = await this.payments.findByCreationIdempotencyKey(idempotencyKey);
    if (idempotentPayment) return idempotentPayment.snapshot();
    if (await this.payments.getByDeliveryJobId(deliveryJobId)) {
      throw new PaymentAlreadyExistsError(`Payment already exists for delivery: ${deliveryJobId}`);
    }

    const payment = Payment.create(paymentId, deliveryJobId, amountMinor, currency);
    await this.payments.saveNew(payment, idempotencyKey);
    return payment.snapshot();
  }
}

export class GetPayment {
  constructor(
    private readonly deliveries: DeliveryJobRepository,
    private readonly payments: PaymentRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, paymentId: string): Promise<ReturnType<Payment['snapshot']>> {
    const payment = await getAuthorizedPayment(principal, paymentId, this.deliveries, this.payments);
    return payment.snapshot();
  }
}

export class InitiatePayment {
  constructor(
    private readonly deliveries: DeliveryJobRepository,
    private readonly payments: PaymentRepository,
    private readonly gateway: PaymentGateway,
  ) {}

  async execute(principal: AuthenticatedPrincipal, paymentId: string, idempotencyKey: string): Promise<PaymentOperationResult> {
    requireIdempotencyKey(idempotencyKey);
    const payment = await getAuthorizedPayment(principal, paymentId, this.deliveries, this.payments);
    const existing = await this.payments.findAttemptByIdempotencyKey(paymentId, 'INITIATE', idempotencyKey);
    if (existing) return { payment: payment.snapshot(), attempt: existing.snapshot() };

    const attemptId = `${paymentId}-initiate-${payment.snapshot().version + 1}`;
    const providerReference = await this.gateway.initializePayment(payment, attemptId);
    const attempt = PaymentAttempt.create(attemptId, paymentId, idempotencyKey, 'INITIATE', providerReference);
    payment.beginProcessing(attemptId);
    await this.payments.saveOperation(payment, payment.snapshot().version - 1, attempt);
    return { payment: payment.snapshot(), attempt: attempt.snapshot() };
  }
}

export class ConfirmPayment {
  constructor(
    private readonly deliveries: DeliveryJobRepository,
    private readonly payments: PaymentRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, paymentId: string, idempotencyKey: string, attemptId?: string): Promise<PaymentOperationResult> {
    return transitionPayment(principal, paymentId, idempotencyKey, 'CONFIRM', 'SUCCEEDED', attemptId, this.deliveries, this.payments);
  }
}

export class FailPayment {
  constructor(
    private readonly deliveries: DeliveryJobRepository,
    private readonly payments: PaymentRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, paymentId: string, idempotencyKey: string, attemptId?: string): Promise<PaymentOperationResult> {
    return transitionPayment(principal, paymentId, idempotencyKey, 'FAIL', 'FAILED', attemptId, this.deliveries, this.payments);
  }
}

export class CancelPayment {
  constructor(
    private readonly deliveries: DeliveryJobRepository,
    private readonly payments: PaymentRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, paymentId: string, idempotencyKey: string): Promise<PaymentOperationResult> {
    requireIdempotencyKey(idempotencyKey);
    const payment = await getAuthorizedPayment(principal, paymentId, this.deliveries, this.payments);
    const existing = await this.payments.findAttemptByIdempotencyKey(paymentId, 'CANCEL', idempotencyKey);
    if (existing) return { payment: payment.snapshot(), attempt: existing.snapshot() };

    const attemptId = `${paymentId}-cancel-${payment.snapshot().version + 1}`;
    payment.cancel();
    const attempt = PaymentAttempt.create(attemptId, paymentId, idempotencyKey, 'CANCEL').withStatus('CANCELLED');
    await this.payments.saveOperation(payment, payment.snapshot().version - 1, attempt);
    return { payment: payment.snapshot(), attempt: attempt.snapshot() };
  }
}

async function transitionPayment(
  principal: AuthenticatedPrincipal,
  paymentId: string,
  idempotencyKey: string,
  operation: 'CONFIRM' | 'FAIL',
  status: 'SUCCEEDED' | 'FAILED',
  attemptId: string | undefined,
  deliveries: DeliveryJobRepository,
  payments: PaymentRepository,
): Promise<PaymentOperationResult> {
  requireIdempotencyKey(idempotencyKey);
  const payment = await getAuthorizedPayment(principal, paymentId, deliveries, payments);
  const existing = await payments.findAttemptByIdempotencyKey(paymentId, operation, idempotencyKey);
  if (existing) return { payment: payment.snapshot(), attempt: existing.snapshot() };

  const sourceAttempt = attemptId
    ? await payments.getAttemptById(attemptId)
    : await payments.getLatestAttempt(paymentId);
  if (!sourceAttempt || sourceAttempt.snapshot().paymentId !== paymentId || sourceAttempt.snapshot().status !== 'PROCESSING') {
    throw new PaymentOperationConflictError('A processing payment attempt is required');
  }

  const newAttemptId = `${paymentId}-${operation.toLowerCase()}-${payment.snapshot().version + 1}`;
  if (status === 'SUCCEEDED') payment.succeed(sourceAttempt.snapshot().id);
  else payment.fail(sourceAttempt.snapshot().id);
  const attempt = PaymentAttempt.create(newAttemptId, paymentId, idempotencyKey, operation).withStatus(status);
  await payments.saveOperation(payment, payment.snapshot().version - 1, attempt);
  return { payment: payment.snapshot(), attempt: attempt.snapshot() };
}

async function getAuthorizedPayment(
  principal: AuthenticatedPrincipal,
  paymentId: string,
  deliveries: DeliveryJobRepository,
  payments: PaymentRepository,
): Promise<Payment> {
  const payment = await payments.getById(paymentId);
  if (!payment) throw new NotFoundError(`Payment not found: ${paymentId}`);
  const delivery = await deliveries.getById(payment.snapshot().deliveryJobId);
  if (!delivery) throw new NotFoundError(`DeliveryJob not found: ${payment.snapshot().deliveryJobId}`);
  requireDeliveryAccess(principal, delivery.snapshot().requesterId);
  return payment;
}

function requireIdempotencyKey(value: string): void {
  if (!value.trim() || value.length > 255) {
    throw new ValidationError('Idempotency-Key is required and must be at most 255 characters');
  }
}
