import type { Pool } from 'pg';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { createPostgresPool } from '../../src/infrastructure/persistence/postgres/postgres-client.js';
import { migrate } from '../../src/infrastructure/persistence/postgres/migrate.js';
import { PostgresOutboxRepository } from '../../src/infrastructure/persistence/postgres/postgres-outbox-repository.js';
import { OutboxWorker } from '../../src/application/outbox/outbox-publisher.js';

const integration = describe.skipIf(!process.env.DATABASE_URL);

integration('PostgreSQL durable outbox', () => {
  let pool: Pool;
  let outbox: PostgresOutboxRepository;

  beforeAll(async () => {
    pool = createPostgresPool();
    await migrate(pool);
    outbox = new PostgresOutboxRepository(pool);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM outbox_events');
  });

  afterAll(async () => {
    await pool.end();
  });

  async function enqueue(id: string): Promise<void> {
    await outbox.enqueue([{ id, aggregateId: `aggregate-${id}`, type: 'TestEvent', payload: { id } }]);
  }

  it('claims an event only once across concurrent workers', async () => {
    await enqueue('claim-once');
    const [first, second] = await Promise.all([
      outbox.claim('worker-a', 1, 30_000),
      outbox.claim('worker-b', 1, 30_000),
    ]);
    expect(first.length + second.length).toBe(1);
  });

  it('claims independent events concurrently', async () => {
    await enqueue('independent-a');
    await enqueue('independent-b');
    const [first, second] = await Promise.all([
      outbox.claim('worker-a', 1, 30_000),
      outbox.claim('worker-b', 1, 30_000),
    ]);
    expect(first.length).toBe(1);
    expect(second.length).toBe(1);
    expect(first[0]?.id).not.toBe(second[0]?.id);
  });

  it('reclaims an expired lease', async () => {
    await enqueue('lease-expiry');
    const initial = new Date('2026-08-22T00:00:00.000Z');
    const claimed = await outbox.claim('worker-a', 1, 1000, initial);
    expect(claimed[0]?.claimedBy).toBe('worker-a');
    const reclaimed = await outbox.claim('worker-b', 1, 1000, new Date('2026-08-22T00:00:02.000Z'));
    expect(reclaimed[0]?.id).toBe('lease-expiry');
    expect(reclaimed[0]?.claimedBy).toBe('worker-b');
    expect(reclaimed[0]?.attempts).toBe(2);
  });

  it('marks a claimed event published and makes it ineligible for normal claims', async () => {
    await enqueue('published');
    const claimed = await outbox.claim('worker-a', 1, 30_000);
    expect(await outbox.markPublished('published', 'worker-a')).toBe(true);
    expect((await outbox.claim('worker-b', 1, 30_000)).length).toBe(0);
    expect((await outbox.getById('published'))?.status).toBe('PUBLISHED');
    expect(claimed[0]?.attempts).toBe(1);
  });

  it('persists retry state', async () => {
    await enqueue('retry');
    const claimed = await outbox.claim('worker-a', 1, 30_000);
    const next = new Date(Date.now() + 60_000);
    const updated = await outbox.markFailure('retry', 'worker-a', 'temporary failure', next, 5);
    expect(claimed[0]?.attempts).toBe(1);
    expect(updated?.status).toBe('PENDING');
    expect(updated?.lastError).toBe('temporary failure');
    expect(updated?.attempts).toBe(1);
  });

  it('dead-letters an event at the retry limit', async () => {
    await enqueue('dead-letter');
    const first = await outbox.claim('worker-a', 1, 30_000);
    const failed = await outbox.markFailure('dead-letter', 'worker-a', 'permanent failure', new Date(), 1);
    expect(first[0]?.attempts).toBe(1);
    expect(failed?.status).toBe('DEAD_LETTER');
    expect((await outbox.claim('worker-b', 1, 30_000)).length).toBe(0);
  });

  it('worker publishes successfully through the publisher port', async () => {
    await enqueue('worker-success');
    const published: string[] = [];
    const worker = new OutboxWorker(outbox, { publish: async event => { published.push(event.id); } }, { workerId: 'worker-test' });
    expect(await worker.processOnce()).toBe(1);
    expect(published).toEqual(['worker-success']);
    expect((await outbox.getById('worker-success'))?.status).toBe('PUBLISHED');
  });

  it('worker schedules a durable retry after publication failure', async () => {
    await enqueue('worker-failure');
    const worker = new OutboxWorker(outbox, { publish: async () => { throw new Error('broker unavailable'); } }, { workerId: 'worker-test', baseRetryMs: 1000, maxAttempts: 5 });
    expect(await worker.processOnce()).toBe(0);
    const event = await outbox.getById('worker-failure');
    expect(event?.status).toBe('PENDING');
    expect(event?.attempts).toBe(1);
    expect(event?.lastError).toBe('broker unavailable');
  });
});
