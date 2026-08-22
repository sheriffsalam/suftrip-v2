import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DeliveryJob } from '../../src/domain/delivery/delivery-job.js';
import { createPostgresPool } from '../../src/infrastructure/persistence/postgres/postgres-client.js';
import { migrate } from '../../src/infrastructure/persistence/postgres/migrate.js';
import { PostgresDeliveryJobRepository } from '../../src/infrastructure/persistence/postgres/postgres-delivery-job-repository.js';
import { PostgresOutboxRepository } from '../../src/infrastructure/persistence/postgres/postgres-outbox-repository.js';
import { OutboxWorker } from '../../src/application/outbox/outbox-publisher.js';

const integration = describe.skipIf(!process.env.DATABASE_URL);

integration('PostgreSQL durable outbox', () => {
  let pool: Pool;
  let outbox: PostgresOutboxRepository;
  let deliveries: PostgresDeliveryJobRepository;

  beforeAll(async () => {
    pool = createPostgresPool();
    await migrate(pool);
    outbox = new PostgresOutboxRepository(pool);
    deliveries = new PostgresDeliveryJobRepository(pool);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM outbox_events');
    await pool.query('DELETE FROM delivery_jobs');
  });

  afterAll(async () => {
    await pool.end();
  });

  async function enqueue(id: string): Promise<void> {
    await outbox.enqueue([{ id, aggregateId: `aggregate-${id}`, type: 'TestEvent', payload: { id } }]);
  }

  function delivery(id: string): DeliveryJob {
    return DeliveryJob.create({
      id,
      requesterId: 'customer',
      pickup: { address: 'Pickup', latitude: 6.6, longitude: 3.35 },
      dropoff: { address: 'Dropoff', latitude: 6.4, longitude: 3.42 },
      deliveryType: 'PARCEL',
    });
  }

  it('persists a delivery status change and its outbox event atomically', async () => {
    const job = delivery('atomic-delivery');
    await deliveries.save(job, 0);
    job.transitionTo('REQUESTED');
    const events = job.pullEvents();
    await deliveries.save(job, 0, events);

    const row = await outbox.getById('delivery-status:atomic-delivery:DRAFT:REQUESTED');
    expect(row?.type).toBe('DeliveryJobStatusChanged');
    expect(row?.aggregateId).toBe('atomic-delivery');
    expect(row?.payload).toMatchObject({ deliveryJobId: 'atomic-delivery', from: 'DRAFT', to: 'REQUESTED' });
    expect((await deliveries.getById('atomic-delivery'))?.snapshot().status).toBe('REQUESTED');
  });

  it('rolls back the event when the aggregate write conflicts', async () => {
    const job = delivery('atomic-conflict');
    await deliveries.save(job, 0);
    job.transitionTo('REQUESTED');
    const events = job.pullEvents();

    await expect(deliveries.save(job, 0, events)).rejects.toThrow(/version conflict/i);
    expect(await outbox.getById('delivery-status:atomic-conflict:DRAFT:REQUESTED')).toBeNull();
    expect((await deliveries.getById('atomic-conflict'))?.snapshot().status).toBe('DRAFT');
  });

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
    const initial = new Date();
    await pool.query('UPDATE outbox_events SET available_at = $1 WHERE id = $2', [initial, 'lease-expiry']);
    const claimed = await outbox.claim('worker-a', 1, 1000, initial);
    expect(claimed[0]?.claimedBy).toBe('worker-a');
    const reclaimed = await outbox.claim('worker-b', 1, 1000, new Date(initial.getTime() + 2000));
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
