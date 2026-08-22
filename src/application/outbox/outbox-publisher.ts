import type { Logger } from '../observability/logger.js';
import type { OutboxRepository } from './outbox-repository.js';
import type { OutboxEvent } from './outbox-event.js';

export interface OutboxEventPublisher {
  publish(event: OutboxEvent): Promise<void>;
}

export type OutboxWorkerOptions = Readonly<{
  workerId: string;
  batchSize?: number;
  leaseMs?: number;
  maxAttempts?: number;
  baseRetryMs?: number;
  logger?: Logger;
}>;

export function retryDelayMs(attempt: number, baseRetryMs = 1_000): number {
  return Math.min(baseRetryMs * 2 ** Math.max(0, attempt - 1), 300_000);
}

export class OutboxWorker {
  private readonly batchSize: number;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly baseRetryMs: number;

  constructor(
    private readonly repository: OutboxRepository,
    private readonly publisher: OutboxEventPublisher,
    private readonly options: OutboxWorkerOptions,
  ) {
    this.batchSize = options.batchSize ?? 20;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseRetryMs = options.baseRetryMs ?? 1_000;
  }

  async processOnce(now = new Date()): Promise<number> {
    const events = await this.repository.claim(this.options.workerId, this.batchSize, this.leaseMs, now);
    let processed = 0;

    for (const event of events) {
      try {
        await this.publisher.publish(event);
        const marked = await this.repository.markPublished(event.id, this.options.workerId, new Date());
        if (marked) {
          this.options.logger?.info('outbox.event.published', { eventId: event.id, eventType: event.type, attempt: event.attempts, workerId: this.options.workerId });
          processed += 1;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown publication failure';
        const nextAttemptAt = new Date(now.getTime() + retryDelayMs(event.attempts, this.baseRetryMs));
        const updated = await this.repository.markFailure(event.id, this.options.workerId, message.slice(0, 1000), nextAttemptAt, this.maxAttempts, now);
        if (updated?.status === 'DEAD_LETTER') {
          this.options.logger?.error('outbox.event.dead_lettered', { eventId: event.id, eventType: event.type, attempt: updated.attempts, workerId: this.options.workerId, error: message.slice(0, 500) });
        } else {
          this.options.logger?.warn('outbox.event.retry_scheduled', { eventId: event.id, eventType: event.type, attempt: event.attempts, workerId: this.options.workerId, nextAttemptAt: nextAttemptAt.toISOString() });
        }
      }
    }

    return processed;
  }
}
