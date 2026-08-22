import type { Logger } from '../observability/logger.js';
import type { NotificationSender } from './notification-sender.js';
import type { NotificationDeliveryQueue } from './notification-delivery-queue.js';

export type NotificationDeliveryWorkerOptions = Readonly<{
  workerId: string;
  batchSize?: number;
  leaseMs?: number;
  maxAttempts?: number;
  logger?: Logger;
}>;

/**
 * Processes durable notification work without introducing a second queueing
 * system. PostgreSQL owns cross-worker claiming; the domain owns transitions;
 * the sender remains an infrastructure adapter behind its application port.
 */
export class NotificationDeliveryWorker {
  private readonly batchSize: number;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly queue: NotificationDeliveryQueue,
    private readonly sender: NotificationSender,
    private readonly options: NotificationDeliveryWorkerOptions,
  ) {
    this.batchSize = options.batchSize ?? 20;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.maxAttempts = options.maxAttempts ?? 5;

    if (!options.workerId.trim()) throw new Error('workerId is required');
    validatePositiveInteger(this.batchSize, 'batchSize');
    validatePositiveInteger(this.leaseMs, 'leaseMs');
    validatePositiveInteger(this.maxAttempts, 'maxAttempts');
  }

  async processOnce(now = new Date()): Promise<number> {
    const claimed = await this.queue.claim(
      this.options.workerId,
      this.batchSize,
      this.leaseMs,
      this.maxAttempts,
      now,
    );

    let completed = 0;
    for (const item of claimed) {
      try {
        item.notification.beginProcessing(item.attemptId);
        const result = await this.sender.send(item.notification, item.attemptId);
        item.notification.markSent(item.attemptId);

        const persisted = await this.queue.markSent(
          this.options.workerId,
          item.attemptId,
          item.notification,
          result.providerReference,
          new Date(),
        );
        if (persisted) completed += 1;
        else this.options.logger?.warn('notification.worker.completion_lost', {
          notificationId: item.notification.snapshot().id,
          attemptId: item.attemptId,
          workerId: this.options.workerId,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown notification delivery failure';

        try {
          item.notification.markFailed(item.attemptId);
          const persisted = await this.queue.markFailed(
            this.options.workerId,
            item.attemptId,
            item.notification,
            new Date(),
          );
          if (persisted) {
            this.options.logger?.warn('notification.worker.delivery_failed', {
              notificationId: item.notification.snapshot().id,
              attemptId: item.attemptId,
              workerId: this.options.workerId,
              error: message.slice(0, 500),
            });
          }
        } catch (persistenceError: unknown) {
          const persistenceMessage = persistenceError instanceof Error
            ? persistenceError.message
            : 'Unknown notification failure persistence error';
          this.options.logger?.error('notification.worker.failure_persistence_failed', {
            notificationId: item.notification.snapshot().id,
            attemptId: item.attemptId,
            workerId: this.options.workerId,
            error: persistenceMessage.slice(0, 500),
          });
        }
      }
    }

    return completed;
  }
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}
