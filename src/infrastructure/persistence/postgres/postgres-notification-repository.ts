import type { Pool, PoolClient } from 'pg';

import type {
  NotificationOperation,
  NotificationRepository,
} from '../../../application/notification/notification-repository.js';
import {
  Notification,
  NotificationAttempt,
  type NotificationAttemptSnapshot,
  type NotificationSnapshot,
} from '../../../domain/notification/notification.js';
import { ConflictError, IdempotencyConflictError } from '../../../shared/errors.js';

type NotificationRow = {
  id: string;
  recipient_id: string;
  channel: NotificationSnapshot['channel'];
  template_key: string;
  payload: NotificationSnapshot['payload'];
  idempotency_key: string;
  status: NotificationSnapshot['status'];
  version: number;
  created_at: Date;
  updated_at: Date;
};

type AttemptRow = {
  id: string;
  notification_id: string;
  status: NotificationAttemptSnapshot['status'];
  provider_reference: string | null;
  created_at: Date;
  updated_at: Date;
};

const NOTIFICATION_COLUMNS = `id, recipient_id, channel, template_key, payload,
  idempotency_key, status, version, created_at, updated_at`;
const ATTEMPT_COLUMNS = `id, notification_id, status, provider_reference,
  created_at, updated_at`;

function toNotification(row: NotificationRow): Notification {
  return Notification.rehydrate({
    id: row.id,
    recipientId: row.recipient_id,
    channel: row.channel,
    templateKey: row.template_key,
    payload: row.payload,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

function toAttempt(row: AttemptRow): NotificationAttempt {
  return NotificationAttempt.rehydrate({
    id: row.id,
    notificationId: row.notification_id,
    status: row.status,
    providerReference: row.provider_reference,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

export class PostgresNotificationRepository implements NotificationRepository {
  constructor(private readonly pool: Pool) {}

  async getById(id: string): Promise<Notification | null> {
    const result = await this.pool.query<NotificationRow>(
      `SELECT ${NOTIFICATION_COLUMNS} FROM notifications WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toNotification(result.rows[0]) : null;
  }

  async findByCreationIdempotencyKey(idempotencyKey: string): Promise<Notification | null> {
    const result = await this.pool.query<NotificationRow>(
      `SELECT n.${NOTIFICATION_COLUMNS.replaceAll(', ', ', n.')}
         FROM notifications n
         JOIN notification_creation_keys k ON k.notification_id = n.id
        WHERE k.idempotency_key = $1`,
      [idempotencyKey],
    );
    return result.rows[0] ? toNotification(result.rows[0]) : null;
  }

  async findAttemptByIdempotencyKey(
    notificationId: string,
    operation: NotificationOperation,
    idempotencyKey: string,
  ): Promise<NotificationAttempt | null> {
    const result = await this.pool.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS}
         FROM notification_attempts a
         JOIN notification_operation_keys k ON k.attempt_id = a.id
        WHERE k.notification_id = $1
          AND k.operation = $2
          AND k.idempotency_key = $3`,
      [notificationId, operation, idempotencyKey],
    );
    return result.rows[0] ? toAttempt(result.rows[0]) : null;
  }

  async hasOperationIdempotencyKey(
    notificationId: string,
    operation: NotificationOperation,
    idempotencyKey: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM notification_operation_keys
        WHERE notification_id = $1 AND operation = $2 AND idempotency_key = $3`,
      [notificationId, operation, idempotencyKey],
    );
    return result.rowCount === 1;
  }

  async getAttemptById(id: string): Promise<NotificationAttempt | null> {
    const result = await this.pool.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM notification_attempts WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toAttempt(result.rows[0]) : null;
  }

  async saveNew(notification: Notification, idempotencyKey: string): Promise<void> {
    const client = await this.pool.connect();
    const snapshot = notification.snapshot();

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO notifications (
           id, recipient_id, channel, template_key, payload,
           idempotency_key, status, version, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          snapshot.id,
          snapshot.recipientId,
          snapshot.channel,
          snapshot.templateKey,
          snapshot.payload,
          snapshot.idempotencyKey,
          snapshot.status,
          snapshot.version,
          snapshot.createdAt,
          snapshot.updatedAt,
        ],
      );
      await client.query(
        `INSERT INTO notification_creation_keys (idempotency_key, notification_id)
         VALUES ($1, $2)`,
        [idempotencyKey, snapshot.id],
      );
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        throw new IdempotencyConflictError();
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async saveOperation(
    notification: Notification,
    expectedVersion: number,
    attempt: NotificationAttempt | null,
    operation: NotificationOperation,
    idempotencyKey: string,
  ): Promise<void> {
    await this.withTransaction(async client => {
      const snapshot = notification.snapshot();

      if (attempt) {
        const attemptSnapshot = attempt.snapshot();
        await client.query(
          `INSERT INTO notification_attempts (
             id, notification_id, status, provider_reference, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            attemptSnapshot.id,
            attemptSnapshot.notificationId,
            attemptSnapshot.status,
            attemptSnapshot.providerReference,
            attemptSnapshot.createdAt,
            attemptSnapshot.updatedAt,
          ],
        );
      }

      await client.query(
        `INSERT INTO notification_operation_keys (
           notification_id, operation, idempotency_key, attempt_id
         ) VALUES ($1, $2, $3, $4)`,
        [snapshot.id, operation, idempotencyKey, attempt?.snapshot().id ?? null],
      );

      const result = await client.query(
        `UPDATE notifications
            SET status = $1, version = version + 1, updated_at = $2
          WHERE id = $3 AND version = $4`,
        [snapshot.status, snapshot.updatedAt, snapshot.id, expectedVersion],
      );

      if (result.rowCount !== 1) {
        throw new ConflictError(`Notification version conflict: expected ${expectedVersion}`);
      }
    });
  }

  private async withTransaction(action: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await action(client);
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) throw new IdempotencyConflictError();
      throw error;
    } finally {
      client.release();
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
