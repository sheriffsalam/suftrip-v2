import type { Pool } from 'pg';
import type { NewOutboxEvent, OutboxEvent, OutboxStatus } from '../../../application/outbox/outbox-event.js';
import type { OutboxRepository } from '../../../application/outbox/outbox-repository.js';

 type OutboxRow = {
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  available_at: Date;
  claimed_by: string | null;
  claim_until: Date | null;
  last_error: string | null;
  created_at: Date;
  published_at: Date | null;
};

function toEvent(row: OutboxRow): OutboxEvent {
  return {
    id: row.id,
    aggregateId: row.aggregate_id,
    type: row.event_type,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    availableAt: row.available_at.toISOString(),
    claimedBy: row.claimed_by,
    claimUntil: row.claim_until?.toISOString() ?? null,
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
    publishedAt: row.published_at?.toISOString() ?? null,
  };
}

export class PostgresOutboxRepository implements OutboxRepository {
  constructor(private readonly pool: Pool) {}

  async enqueue(events: readonly NewOutboxEvent[]): Promise<void> {
    for (const event of events) {
      await this.pool.query(
        `INSERT INTO outbox_events (id, aggregate_id, event_type, payload)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [event.id, event.aggregateId, event.type, JSON.stringify(event.payload)],
      );
    }
  }

  async claim(workerId: string, limit: number, leaseMs: number, now = new Date()): Promise<OutboxEvent[]> {
    const result = await this.pool.query<OutboxRow>(
      `WITH candidates AS (
         SELECT id
           FROM outbox_events
          WHERE available_at <= $1
            AND (
              status = 'PENDING'
              OR (status = 'PROCESSING' AND claim_until <= $1)
            )
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT $2
       )
       UPDATE outbox_events AS e
          SET status = 'PROCESSING',
              attempts = e.attempts + 1,
              claimed_by = $3,
              claim_until = $1 + ($4::bigint * interval '1 millisecond')
         FROM candidates
        WHERE e.id = candidates.id
       RETURNING e.*`,
      [now, limit, workerId, leaseMs],
    );
    return result.rows.map(toEvent);
  }

  async markPublished(eventId: string, workerId: string, publishedAt = new Date()): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE outbox_events
          SET status = 'PUBLISHED',
              published_at = $1,
              claimed_by = NULL,
              claim_until = NULL,
              last_error = NULL
        WHERE id = $2
          AND status = 'PROCESSING'
          AND claimed_by = $3
          AND claim_until > $1`,
      [publishedAt, eventId, workerId],
    );
    return result.rowCount === 1;
  }

  async markFailure(eventId: string, workerId: string, error: string, nextAttemptAt: Date, maxAttempts: number, now = new Date()): Promise<OutboxEvent | null> {
    const result = await this.pool.query<OutboxRow>(
      `UPDATE outbox_events
          SET status = CASE WHEN attempts >= $4 THEN 'DEAD_LETTER' ELSE 'PENDING' END,
              available_at = CASE WHEN attempts >= $4 THEN available_at ELSE $2 END,
              claimed_by = NULL,
              claim_until = NULL,
              last_error = $3
        WHERE id = $1
          AND status = 'PROCESSING'
          AND claimed_by = $5
          AND claim_until > $6
       RETURNING *`,
      [eventId, nextAttemptAt, error, maxAttempts, workerId, now],
    );
    return result.rows[0] ? toEvent(result.rows[0]) : null;
  }

  async getById(eventId: string): Promise<OutboxEvent | null> {
    const result = await this.pool.query<OutboxRow>('SELECT * FROM outbox_events WHERE id = $1', [eventId]);
    return result.rows[0] ? toEvent(result.rows[0]) : null;
  }
}
