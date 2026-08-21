import {
  InvalidTransitionError,
  ValidationError,
} from '../../shared/errors.js';

export const PAYMENT_STATUSES = [
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_ATTEMPT_STATUSES = [
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;

export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];

export const PAYMENT_OPERATIONS = [
  'INITIATE',
  'CONFIRM',
  'FAIL',
  'CANCEL',
] as const;

export type PaymentOperation = (typeof PAYMENT_OPERATIONS)[number];

export type PaymentSnapshot = Readonly<{
  id: string;
  deliveryJobId: string;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type PaymentAttemptSnapshot = Readonly<{
  id: string;
  paymentId: string;
  status: PaymentAttemptStatus;
  operation: PaymentOperation;
  idempotencyKey: string;
  providerReference: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type PaymentEvent =
  | Readonly<{ type: 'PaymentCreated'; paymentId: string; deliveryJobId: string }>
  | Readonly<{ type: 'PaymentInitiated'; paymentId: string; attemptId: string }>
  | Readonly<{ type: 'PaymentSucceeded'; paymentId: string; attemptId: string }>
  | Readonly<{ type: 'PaymentFailed'; paymentId: string; attemptId: string }>
  | Readonly<{ type: 'PaymentCancelled'; paymentId: string }>;

const TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  PENDING: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SUCCEEDED', 'FAILED', 'CANCELLED'],
  SUCCEEDED: [],
  FAILED: ['PROCESSING'],
  CANCELLED: [],
};

export class InvalidPaymentTransitionError extends InvalidTransitionError {}

export class Payment {
  private readonly events: PaymentEvent[] = [];

  private constructor(private state: PaymentSnapshot) {}

  static create(
    id: string,
    deliveryJobId: string,
    amountMinor: number,
    currency: string,
  ): Payment {
    validatePaymentInput(id, deliveryJobId, amountMinor, currency);
    const now = new Date().toISOString();
    const payment = new Payment({
      id,
      deliveryJobId,
      amountMinor,
      currency,
      status: 'PENDING',
      version: 0,
      createdAt: now,
      updatedAt: now,
    });
    payment.events.push({ type: 'PaymentCreated', paymentId: id, deliveryJobId });
    return payment;
  }

  static rehydrate(snapshot: PaymentSnapshot): Payment {
    validatePaymentInput(snapshot.id, snapshot.deliveryJobId, snapshot.amountMinor, snapshot.currency);
    if (!PAYMENT_STATUSES.includes(snapshot.status)) {
      throw new ValidationError(`Invalid payment status: ${String(snapshot.status)}`);
    }
    if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 0) {
      throw new ValidationError('Payment version must be a non-negative safe integer');
    }
    return new Payment(snapshot);
  }

  beginProcessing(attemptId: string): void {
    this.transitionTo('PROCESSING');
    this.events.push({ type: 'PaymentInitiated', paymentId: this.state.id, attemptId });
  }

  succeed(attemptId: string): void {
    this.transitionTo('SUCCEEDED');
    this.events.push({ type: 'PaymentSucceeded', paymentId: this.state.id, attemptId });
  }

  fail(attemptId: string): void {
    this.transitionTo('FAILED');
    this.events.push({ type: 'PaymentFailed', paymentId: this.state.id, attemptId });
  }

  cancel(): void {
    this.transitionTo('CANCELLED');
    this.events.push({ type: 'PaymentCancelled', paymentId: this.state.id });
  }

  transitionTo(next: PaymentStatus): void {
    if (!TRANSITIONS[this.state.status].includes(next)) {
      throw new InvalidPaymentTransitionError(
        `Invalid Payment transition: ${this.state.status} -> ${next}`,
      );
    }
    this.state = {
      ...this.state,
      status: next,
      version: this.state.version + 1,
      updatedAt: new Date().toISOString(),
    };
  }

  snapshot(): PaymentSnapshot {
    return this.state;
  }

  pullEvents(): readonly PaymentEvent[] {
    return this.events.splice(0);
  }
}

export class PaymentAttempt {
  private constructor(private readonly state: PaymentAttemptSnapshot) {}

  static create(
    id: string,
    paymentId: string,
    idempotencyKey: string,
    operation: PaymentOperation,
    providerReference: string | null = null,
  ): PaymentAttempt {
    if (!id.trim()) throw new ValidationError('PaymentAttempt id is required');
    if (!paymentId.trim()) throw new ValidationError('Payment id is required');
    if (!idempotencyKey.trim()) throw new ValidationError('Idempotency key is required');
    if (!PAYMENT_OPERATIONS.includes(operation)) throw new ValidationError('Payment operation is invalid');
    const now = new Date().toISOString();
    return new PaymentAttempt({
      id,
      paymentId,
      status: 'PROCESSING',
      operation,
      idempotencyKey,
      providerReference,
      createdAt: now,
      updatedAt: now,
    });
  }

  static rehydrate(snapshot: PaymentAttemptSnapshot): PaymentAttempt {
    if (!PAYMENT_ATTEMPT_STATUSES.includes(snapshot.status) || !PAYMENT_OPERATIONS.includes(snapshot.operation)) {
      throw new ValidationError(`Invalid payment attempt status: ${String(snapshot.status)}`);
    }
    if (!snapshot.id.trim() || !snapshot.paymentId.trim() || !snapshot.idempotencyKey.trim()) {
      throw new ValidationError('PaymentAttempt identifiers are required');
    }
    return new PaymentAttempt(snapshot);
  }

  withStatus(status: PaymentAttemptStatus): PaymentAttempt {
    return new PaymentAttempt({ ...this.state, status, updatedAt: new Date().toISOString() });
  }

  snapshot(): PaymentAttemptSnapshot {
    return this.state;
  }
}

function validatePaymentInput(
  id: string,
  deliveryJobId: string,
  amountMinor: number,
  currency: string,
): void {
  if (!id.trim()) throw new ValidationError('Payment id is required');
  if (!deliveryJobId.trim()) throw new ValidationError('DeliveryJob id is required');
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new ValidationError('Payment amountMinor must be a positive safe integer');
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ValidationError('Payment currency must be a three-letter uppercase code');
  }
}