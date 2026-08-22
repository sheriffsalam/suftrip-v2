import type { NewOutboxEvent, OutboxEvent } from './outbox-event.js';

export interface OutboxRepository {
  enqueue(events: readonly NewOutboxEvent[]): Promise<void>;
  claim(workerId: string, limit: number, leaseMs: number, now?: Date): Promise<OutboxEvent[]>;
  markPublished(eventId: string, workerId: string, publishedAt?: Date): Promise<boolean>;
  markFailure(eventId: string, workerId: string, error: string, nextAttemptAt: Date, maxAttempts: number, now?: Date): Promise<OutboxEvent | null>;
  getById(eventId: string): Promise<OutboxEvent | null>;
}
