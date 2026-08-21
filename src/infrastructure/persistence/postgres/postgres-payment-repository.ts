import type { Pool, PoolClient } from 'pg';

import type { PaymentRepository } from '../../../application/payment/payment-repository.js';
import {
  Payment,
  PaymentAttempt,
  type PaymentAttemptSnapshot,
  type PaymentSnapshot,
} from '../../../domain/payment/payment.js';
import {
  ConflictError,
  IdempotencyConflictError,
  PaymentAlreadyExistsError,
  PaymentConcurrencyConflictError,
} from '../../../shared/errors.js';

type PaymentRow = {
  id: string;
  delivery_job_id: string;
  amount_minor: string;
  currency: string;
  status: PaymentSnapshot['status'];
  version: number;
  created_at: Date;
  updated_at: Date;
};

type AttemptRow = {
  id: string;
  payment_id: string;
  status: PaymentAttemptSnapshot['status'];
  operation: PaymentAttemptSnapshot['operation'];
  idempotency_key: string;
  provider_reference: string | null;
  created_at: Date;
  updated_at: Date;
};

function toPayment(row: PaymentRow): Payment {
  const amountMinor = Number(row.amount_minor);
  if (!Number.isSafeInteger(amountMinor)) {
    throw new Error('Persisted payment amount is outside JavaScript safe integer range');
  }
  return Payment.rehydrate({
    id: row.id,
    deliveryJobId: row.delivery_job_id,
    amountMinor,
    currency: row.currency,
    status: row.status,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

function toAttempt(row: AttemptRow): PaymentAttempt {
  return PaymentAttempt.rehydrate({
    id: row.id,
    paymentId: row.payment_id,
    status: row.status,
    operation: row.operation,
    idempotencyKey: row.idempotency_key,
    providerReference: row.provider_reference,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

const PAYMENT_COLUMNS = `id, delivery_job_id, amount_minor, currency,
  status, version, created_at, updated_at`;
const ATTEMPT_COLUMNS = `id, payment_id, status, operation, idempotency_key,
  provider_reference, created_at, updated_at`;

export class PostgresPaymentRepository implements PaymentRepository {
  constructor(private readonly pool: Pool) {}

  async getById(id: string): Promise<Payment | null> {
    const result = await this.pool.query<PaymentRow>(
      `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toPayment(result.rows[0]) : null;
  }

  async getByDeliveryJobId(deliveryJobId: string): Promise<Payment | null> {
    const result = await this.pool.query<PaymentRow>(
      `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE delivery_job_id = $1`,
      [deliveryJobId],
    );
    return result.rows[0] ? toPayment(result.rows[0]) : null;
  }

  async getAttemptById(id: string): Promise<PaymentAttempt | null> {
    const result = await this.pool.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM payment_attempts WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toAttempt(result.rows[0]) : null;
  }

  async getLatestAttempt(paymentId: string): Promise<PaymentAttempt | null> {
    const result = await this.pool.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM payment_attempts
       WHERE payment_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [paymentId],
    );
    return result.rows[0] ? toAttempt(result.rows[0]) : null;
  }

  async findAttemptByIdempotencyKey(
    paymentId: string,
    operation: PaymentAttemptSnapshot['operation'],
    idempotencyKey: string,
  ): Promise<PaymentAttempt | null> {
    const result = await this.pool.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM payment_attempts
       WHERE payment_id = $1 AND operation = $2 AND idempotency_key = $3`,
      [paymentId, operation, idempotencyKey],
    );
    return result.rows[0] ? toAttempt(result.rows[0]) : null;
  }

  async findByCreationIdempotencyKey(idempotencyKey: string): Promise<Payment | null> {
    const result = await this.pool.query<PaymentRow>(
      `SELECT p.${PAYMENT_COLUMNS.replaceAll(', ', ', p.')}
       FROM payments p JOIN payment_creation_keys k ON k.payment_id = p.id
       WHERE k.idempotency_key = $1`,
      [idempotencyKey],
    );
    return result.rows[0] ? toPayment(result.rows[0]) : null;
  }

  async saveNew(payment: Payment, idempotencyKey: string): Promise<void> {
    const client = await this.pool.connect();
    const snapshot = payment.snapshot();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO payments (id, delivery_job_id, amount_minor, currency, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [snapshot.id, snapshot.deliveryJobId, snapshot.amountMinor, snapshot.currency, snapshot.status, snapshot.version, snapshot.createdAt, snapshot.updatedAt],
      );
      await client.query(
        'INSERT INTO payment_creation_keys (idempotency_key, payment_id) VALUES ($1, $2)',
        [idempotencyKey, snapshot.id],
      );
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        if (await this.paymentExists(snapshot.id)) throw new PaymentAlreadyExistsError(`Payment already exists: ${snapshot.id}`);
        throw new IdempotencyConflictError();
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async saveOperation(
    payment: Payment,
    expectedVersion: number,
    attempt: PaymentAttempt,
  ): Promise<void> {
    await this.withTransaction(async client => {
      const snapshot = attempt.snapshot();
      try {
        await client.query(
          `INSERT INTO payment_attempts (id, payment_id, status, operation, idempotency_key, provider_reference, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [snapshot.id, snapshot.paymentId, snapshot.status, snapshot.operation, snapshot.idempotencyKey, snapshot.providerReference, snapshot.createdAt, snapshot.updatedAt],
        );
      } catch (error: unknown) {
        if (isUniqueViolation(error)) throw new IdempotencyConflictError();
        throw error;
      }

      const paymentSnapshot = payment.snapshot();
      const result = await client.query(
        `UPDATE payments SET status = $1, version = version + 1, updated_at = $2
         WHERE id = $3 AND version = $4`,
        [paymentSnapshot.status, paymentSnapshot.updatedAt, paymentSnapshot.id, expectedVersion],
      );
      if (result.rowCount !== 1) throw new PaymentConcurrencyConflictError();
    });
  }

  private async paymentExists(id: string): Promise<boolean> {
    const result = await this.pool.query('SELECT 1 FROM payments WHERE id = $1', [id]);
    return result.rowCount === 1;
  }

  private async withTransaction(action: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await action(client);
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

void ConflictError;
