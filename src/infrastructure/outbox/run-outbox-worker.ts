import { createPostgresPool } from '../persistence/postgres/postgres-client.js';
import { migrate } from '../persistence/postgres/migrate.js';
import { PostgresDeliveryJobRepository } from '../persistence/postgres/postgres-delivery-job-repository.js';
import { PostgresOutboxRepository } from '../persistence/postgres/postgres-outbox-repository.js';
import { PostgresNotificationRepository } from '../persistence/postgres/postgres-notification-repository.js';
import { CreateNotification } from '../../application/notification/notification-use-cases.js';
import { DeliveryNotificationOutboxPublisher } from './delivery-notification-outbox-publisher.js';
import { OutboxWorker } from '../../application/outbox/outbox-publisher.js';
import { JsonLogger } from '../observability/json-logger.js';

const pool = createPostgresPool();
const logger = new JsonLogger();
await migrate(pool);
const deliveries = new PostgresDeliveryJobRepository(pool);
const notifications = new PostgresNotificationRepository(pool);
const createNotification = new CreateNotification(notifications);
const publisher = new DeliveryNotificationOutboxPublisher(deliveries, createNotification);
const worker = new OutboxWorker(new PostgresOutboxRepository(pool), publisher, {
  workerId: `outbox-worker-${process.pid}`,
  logger,
});

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await pool.end();
};
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

while (!stopping) {
  try {
    await worker.processOnce();
  } catch (error: unknown) {
    logger.error('outbox.worker.failed', { error: error instanceof Error ? error.message : 'Unknown worker failure' });
  }
  await new Promise(resolve => setTimeout(resolve, 1_000));
}
