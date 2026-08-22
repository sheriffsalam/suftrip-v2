import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthenticatedPrincipal } from '../../src/application/auth/authentication.js';
import { CreateNotification } from '../../src/application/notification/notification-use-cases.js';
import { NotificationDeliveryWorker } from '../../src/application/notification/notification-delivery-worker.js';
import type { NotificationSender } from '../../src/application/notification/notification-sender.js';
import { PostgresNotificationDeliveryQueue } from '../../src/infrastructure/persistence/postgres/postgres-notification-delivery-queue.js';
import { PostgresNotificationRepository } from '../../src/infrastructure/persistence/postgres/postgres-notification-repository.js';
import { createPostgresPool } from '../../src/infrastructure/persistence/postgres/postgres-client.js';
import { migrate } from '../../src/infrastructure/persistence/postgres/migrate.js';

const integration = describe.skipIf(!process.env.DATABASE_URL);
const customer: AuthenticatedPrincipal = { userId: 'notification-worker-customer', roles: ['CUSTOMER'] };

async function createNotification(repository: PostgresNotificationRepository, id: string): Promise<void> {
  await new CreateNotification(repository).execute(
    customer,
    id,
    customer.userId,
    'PUSH',
    'delivery.status.updated',
    { deliveryId: id, message: 'Your delivery is on the way' },
    `create-${id}`,
  );
}

integration('PostgreSQL notification delivery worker', () => {
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

  it('claims and completes queued notification delivery durably', async () => {
    await createNotification(repository, 'worker-notification-1');
    const queue = new PostgresNotificationDeliveryQueue(pool);
    const claimed = await queue.claim('worker-1', 10, 30_000, 5, new Date('2026-08-22T11:00:00.000Z'));

    expect(claimed).toHaveLength(1);
    const item = claimed[0];
    if (!item) throw new Error('Expected one claimed notification');
    expect(item.notification.snapshot().status).toBe('QUEUED');

    item.notification.beginProcessing(item.attemptId);
    item.notification.markSent(item.attemptId);
    expect(
      await queue.markSent('worker-1', item.attemptId, item.notification, 'provider-1'),
    ).toBe(true);

    expect((await repository.getById('worker-notification-1'))?.snapshot().status).toBe('SENT');
    expect((await repository.getAttemptById(item.attemptId))?.snapshot().status).toBe('SENT');
  });

  it('allows only one concurrent worker to claim a notification', async () => {
    await createNotification(repository, 'worker-notification-2');
    const queueA = new PostgresNotificationDeliveryQueue(pool);
    const queueB = new PostgresNotificationDeliveryQueue(pool);
    const now = new Date('2026-08-22T11:01:00.000Z');

    const [first, second] = await Promise.all([
      queueA.claim('worker-a', 10, 30_000, 5, now),
      queueB.claim('worker-b', 10, 30_000, 5, now),
    ]);

    expect(first.length + second.length).toBe(1);
    expect(new Set([...first, ...second].map(item => item.notification.snapshot().id)).size).toBe(1);
  });

  it('reclaims an expired lease and refuses completion by the previous worker', async () => {
    await createNotification(repository, 'worker-notification-3');
    const queue = new PostgresNotificationDeliveryQueue(pool);
    const initial = new Date('2026-08-22T11:02:00.000Z');
    const claimed = await queue.claim('worker-a', 10, 1_000, 5, initial);
    expect(claimed).toHaveLength(1);
    const original = claimed[0];
    if (!original) throw new Error('Expected the initial worker to claim one notification');

    const reclaimed = await queue.claim('worker-b', 10, 30_000, 5, new Date(initial.getTime() + 2_000));
    expect(reclaimed).toHaveLength(1);
    const replacement = reclaimed[0];
    if (!replacement) throw new Error('Expected the replacement worker to reclaim one notification');
    expect(replacement.attemptId).not.toBe(original.attemptId);

    original.notification.beginProcessing(original.attemptId);
    original.notification.markSent(original.attemptId);
    expect(await queue.markSent('worker-a', original.attemptId, original.notification, 'late')).toBe(false);
  });

  it('processes a claimed batch through the application worker', async () => {
    await createNotification(repository, 'worker-notification-4');
    const queue = new PostgresNotificationDeliveryQueue(pool);
    const sender: NotificationSender = {
      async send(_notification, attemptId) {
        return { providerReference: `provider-${attemptId}` };
      },
    };

    const worker = new NotificationDeliveryWorker(queue, sender, {
      workerId: 'worker-application',
      batchSize: 10,
    });

    expect(await worker.processOnce(new Date('2026-08-22T11:03:00.000Z'))).toBe(1);
    expect((await repository.getById('worker-notification-4'))?.snapshot().status).toBe('SENT');
  });
});
