import type { Pool } from 'pg';

import type {
  ClaimedNotification,
  NotificationDeliveryQueue,
} from '../../../application/notification/notification-delivery-queue.js';
import {
  Notification,
  NotificationAttempt,
  type NotificationSnapshot,
} from '../../../domain/notification/notification.js';

type ClaimedRow = NotificationSnapshot & {
  attempts: number;
};

const COLUMNS = `n.id, n.recipient_id, n.channel, n.template_key, n.payload,
  n.idempotency_key, n.status, n.version, n.created_at, n.updated_at`;

export class PostgresNotificationDeliveryQueue implements NotificationDeliveryQueue {
  constructor(private readonly pool: Pool) {}

  async claim(
    workerId: string,
    limit: number,
    leaseMs: number,
    maxAttempts: number,
    now = new Date(),
  ): Promise<ClaimedNotification[]> {
    validatePositiveInteger(limit, 'limit');
    validatePositiveInteger(leaseMs, 'leaseMs');
    validatePositiveInteger(maxAttempts, 'maxAttempts');
    if (!workerId.trim()) throw new Error('workerId is required');

    const leaseUntil = new Date(now.getTime() + leaseMs);
    const result = await this.pool.query<ClaimedRow & { delivery_lease_until: Date }>(
      `WITH candidates AS (
         SELECT n.id
           FROM notifications n
          WHERE n.status IN ('QUEUED', 'FAILED')
            AND (n.delivery_lease_until IS NULL OR n.delivery_lease_until <= $1)
            AND (
              SELECT COUNT(*)
                FROM notification_attempts a
               WHERE a.notification_id = n.id
            ) < $2
          ORDER BY n.created_at, n.id
          FOR UPDATE SKIP LOCKED
          LIMIT $3
       )
       UPDATE notifications n
          SET delivery_worker_id = $4,
              delivery_lease_until = $5
         FROM candidates c
        WHERE n.id = c.id
       RETURNING ${COLUMNS},
         (SELECT COUNT(*)::integer FROM notification_attempts a WHERE a.notification_id = n.id) AS attempts,
         n.delivery_lease_until`,
      [now, maxAttempts, limit, workerId, leaseUntil],
    );

    return result.rows.map(row => ({
      notification: Notification.rehydrate({
        id: row.id,
        recipientId: row.recipientId,
        channel: row.channel,
        templateKey: row.templateKey,
        payload: row.payload,
        idempotencyKey: row.idempotencyKey,
        status: row.status,
        version: row.version,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }),
      attemptId: `${row.id}-worker-${workerId}-${row.attempts + 1}`,
      attempts: row.attempts,
    }));
  }

  async markSent(
    workerId: string,
    attemptId: string,
    notification: Notification,
    providerReference: string | null,
    now = new Date(),
  ): Promise<boolean> {
    const snapshot = notification.snapshot();
    const attempt = NotificationAttempt.create(attemptId, snapshot.id, providerReference).withStatus(
      'SENT',
      providerReference,
    );

    return this.complete(workerId, attemptId, snapshot, attempt.snapshot(), now);
  }

  async markFailed(
    workerId: string,
    attemptId: string,
    notification: Notification,
    now = new Date(),
  ): Promise<boolean> {
    const snapshot = notification.snapshot();
    const attempt = NotificationAttempt.create(attemptId, snapshot.id).withStatus('FAILED');
    return this.complete(workerId, attemptId, snapshot, attempt.snapshot(), now);
  }

  private async complete(
    workerId: string,
    attemptId: string,
    notification: NotificationSnapshot,
    attempt: ReturnType<NotificationAttempt['snapshot']>,
    now: Date,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `UPDATE notifications
            SET status = $1,
                version = $2,
                updated_at = $3,
                delivery_worker_id = NULL,
                delivery_lease_until = NULL
          WHERE id = $4
            AND version = $5
            AND delivery_worker_id = $6
            AND delivery_lease_until > $7`,
        [
          notification.status,
          notification.version,
          notification.updatedAt,
          notification.id,
          notification.version - 1,
          workerId,
          now,
        ],
      );

      if (result.rowCount !== 1) {
        await client.query('ROLLBACK');
        return false;
      }

      await client.query(
        `INSERT INTO notification_attempts
          (id, notification_id, status, provider_reference, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          attempt.id,
          attempt.notificationId,
          attempt.status,
          attempt.providerReference,
          attempt.createdAt,
          attempt.updatedAt,
        ],
      );

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}
