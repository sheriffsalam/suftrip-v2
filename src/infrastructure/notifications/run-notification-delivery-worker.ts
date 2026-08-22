import { createPostgresPool } from '../persistence/postgres/postgres-client.js';
import { PostgresNotificationDeliveryQueue } from '../persistence/postgres/postgres-notification-delivery-queue.js';
import { DeterministicNotificationSender } from './deterministic-notification-sender.js';
import { NotificationDeliveryWorker } from '../../application/notification/notification-delivery-worker.js';
import { NotificationDeliveryWorkerRunner } from './notification-delivery-worker-runner.js';
import { JsonLogger } from '../observability/json-logger.js';

const pool = createPostgresPool();
const logger = new JsonLogger();
const queue = new PostgresNotificationDeliveryQueue(pool);
const sender = new DeterministicNotificationSender();
const worker = new NotificationDeliveryWorker(queue, sender, {
  workerId: process.env.NOTIFICATION_WORKER_ID?.trim() || `notification-worker-${process.pid}`,
  batchSize: configuredInteger('NOTIFICATION_WORKER_BATCH_SIZE', 20),
  leaseMs: configuredInteger('NOTIFICATION_WORKER_LEASE_MS', 30_000),
  maxAttempts: configuredInteger('NOTIFICATION_WORKER_MAX_ATTEMPTS', 5),
  logger,
});
const runner = new NotificationDeliveryWorkerRunner(worker, {
  pollIntervalMs: configuredInteger('NOTIFICATION_WORKER_POLL_INTERVAL_MS', 1_000),
  logger,
});

let stopping = false;

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  runner.stop();
  await pool.end();
}

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

runner.start();

function configuredInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
