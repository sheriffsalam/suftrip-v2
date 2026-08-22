import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthenticatedPrincipal } from '../../src/application/auth/authentication.js';
import { CreateNotification, RetryNotification, SendNotification } from '../../src/application/notification/notification-use-cases.js';
import type { Notification } from '../../src/domain/notification/notification.js';
import type { NotificationSender } from '../../src/application/notification/notification-sender.js';
import { PostgresNotificationRepository } from '../../src/infrastructure/persistence/postgres/postgres-notification-repository.js';
import { createPostgresPool } from '../../src/infrastructure/persistence/postgres/postgres-client.js';
import { migrate } from '../../src/infrastructure/persistence/postgres/migrate.js';
import { ConflictError, IdempotencyConflictError } from '../../src/shared/errors.js';

const integration = describe.skipIf(!process.env.DATABASE_URL);
const customer: AuthenticatedPrincipal = { userId: 'notification-customer', roles: ['CUSTOMER'] };

function sender(reference = 'provider-1'): NotificationSender {
  return {
    async send(_notification: Notification, _attemptId: string) {
      return { providerReference: reference };
    },
  };
}

function failingSender(): NotificationSender {
  return {
    async send() {
      throw new Error('provider unavailable');
    },
  };
}

async function createNotification(repository: PostgresNotificationRepository, id = 'notification-1') {
  return new CreateNotification(repository).execute(
    customer,
    id,
    customer.userId,
    'IN_APP',
    'delivery.status.updated',
    { deliveryId: 'delivery-1', message: 'Your delivery is on the way' },
    'create-key-notification-1',
  );
}

integration('PostgreSQL notification persistence', () => {
  let pool: Pool;
  let repository: PostgresNotificationRepository;

  beforeAll(async () => {
    pool = createPostgresPool();
    await migrate(pool);
    repository = new PostgresNotificationRepository(pool);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM notification_operation_keys');
    await pool.query('DELETE FROM notification_attempts');
    await pool.query('DELETE FROM notification_creation_keys');
    await pool.query('DELETE FROM notifications');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('persists and rehydrates a notification across repository instances', async () => {
    const created = await createNotification(repository);
    const freshRepository = new PostgresNotificationRepository(pool);
    const retrieved = await freshRepository.getById('notification-1');

    expect(created).toMatchObject({ id: 'notification-1', status: 'QUEUED', version: 0 });
    expect(retrieved?.snapshot()).toMatchObject({
      id: 'notification-1',
      recipientId: customer.userId,
      channel: 'IN_APP',
      templateKey: 'delivery.status.updated',
      status: 'QUEUED',
      version: 0,
    });
  });

  it('enforces creation and operation idempotency without duplicate attempts', async () => {
    const first = await createNotification(repository);
    const second = await createNotification(repository, 'different-id');
    expect(second).toEqual(first);

    const send = new SendNotification(repository, sender());
    const sent = await send.execute(customer, 'notification-1', 'send-key-1');
    const replay = await send.execute(customer, 'notification-1', 'send-key-1');

    expect(replay).toEqual(sent);
    const attempts = await pool.query('SELECT count(*)::int AS count FROM notification_attempts');
    expect(attempts.rows[0].count).toBe(1);
  });

  it('persists a failed attempt and supports retry', async () => {
    await createNotification(repository);

    await expect(new SendNotification(repository, failingSender()).execute(customer, 'notification-1', 'send-key-1'))
      .rejects.toThrow('provider unavailable');

    expect((await repository.getById('notification-1'))?.snapshot().status).toBe('FAILED');
    expect((await repository.getAttemptById('notification-1-send-1'))?.snapshot().status).toBe('FAILED');

    const retry = await new RetryNotification(repository, sender('provider-retry')).execute(
      customer,
      'notification-1',
      'retry-key-1',
    );

    expect(retry.notification.status).toBe('SENT');
    expect(retry.attempt.status).toBe('SENT');
  });

  it('persists cancellation without creating an attempt', async () => {
    await createNotification(repository);
    const notification = await repository.getById('notification-1');
    if (!notification) throw new Error('test setup failed');

    const expectedVersion = notification.snapshot().version;
    notification.cancel();
    await repository.saveOperation(notification, expectedVersion, null, 'CANCEL', 'cancel-key-1');

    expect((await repository.getById('notification-1'))?.snapshot().status).toBe('CANCELLED');
    const attempts = await pool.query('SELECT count(*)::int AS count FROM notification_attempts');
    expect(attempts.rows[0].count).toBe(0);
    expect(await repository.hasOperationIdempotencyKey('notification-1', 'CANCEL', 'cancel-key-1')).toBe(true);
  });

  it('rejects stale notification updates at the database boundary', async () => {
    await createNotification(repository);
    const first = await repository.getById('notification-1');
    const second = await repository.getById('notification-1');
    if (!first || !second) throw new Error('test setup failed');

    first.cancel();
    await repository.saveOperation(first, 0, null, 'CANCEL', 'cancel-key-1');

    second.cancel();
    await expect(repository.saveOperation(second, 0, null, 'CANCEL', 'cancel-key-2'))
      .rejects.toBeInstanceOf(ConflictError);

    await expect(repository.saveOperation(second, 1, null, 'CANCEL', 'cancel-key-1'))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});
