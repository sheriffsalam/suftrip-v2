import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DeliveryJob } from '../../src/domain/delivery/delivery-job.js';
import { ConflictError } from '../../src/shared/errors.js';
import { migrate } from '../../src/infrastructure/persistence/postgres/migrate.js';
import { createPostgresPool } from '../../src/infrastructure/persistence/postgres/postgres-client.js';
import { PostgresDeliveryJobRepository } from '../../src/infrastructure/persistence/postgres/postgres-delivery-job-repository.js';

const integration = describe.skipIf(!process.env.DATABASE_URL);

function createJob(id = 'integration-job-1') {
  return DeliveryJob.create({
    id,
    requesterId: 'integration-requester',
    pickup: {
      address: 'Ikeja, Lagos',
      latitude: 6.6018,
      longitude: 3.3515,
    },
    dropoff: {
      address: 'Victoria Island, Lagos',
      latitude: 6.4281,
      longitude: 3.4219,
    },
    deliveryType: 'PARCEL',
  });
}

integration('PostgresDeliveryJobRepository', () => {
  let pool: Pool;
  let repository: PostgresDeliveryJobRepository;

  beforeAll(async () => {
    pool = createPostgresPool();
    await migrate(pool);
    repository = new PostgresDeliveryJobRepository(pool);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM dispatch_jobs');
    await pool.query('DELETE FROM providers');
    await pool.query('DELETE FROM delivery_jobs');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('persists and rehydrates a delivery job', async () => {
    const job = createJob();
    const createdAt = job.snapshot().createdAt;

    await repository.save(job, 0);
    const retrieved = await repository.getById(job.snapshot().id);

    expect(retrieved?.snapshot()).toMatchObject({
      id: job.snapshot().id,
      status: 'DRAFT',
      version: 0,
      createdAt,
      updatedAt: createdAt,
    });
  });

  it('preserves records for a new repository instance', async () => {
    await repository.save(createJob('restart-job'), 0);
    const newRepository = new PostgresDeliveryJobRepository(pool);
    const retrieved = await newRepository.getById('restart-job');

    expect(retrieved?.snapshot()).toMatchObject({
      id: 'restart-job',
      status: 'DRAFT',
      version: 0,
    });
  });

  it('persists status and version changes', async () => {
    const job = createJob('update-job');
    await repository.save(job, 0);
    const loaded = await repository.getById('update-job');
    const createdAt = loaded!.snapshot().createdAt;

    loaded!.transitionTo('REQUESTED');
    await repository.save(loaded!, 0);
    const updated = await repository.getById('update-job');

    expect(updated?.snapshot()).toMatchObject({
      status: 'REQUESTED',
      version: 1,
      createdAt,
    });
    expect(updated!.snapshot().updatedAt).not.toBe(createdAt);
  });

  it('rejects stale updates at the database boundary', async () => {
    await repository.save(createJob('concurrency-job'), 0);
    const first = await repository.getById('concurrency-job');
    const second = await repository.getById('concurrency-job');
    first!.transitionTo('REQUESTED');
    second!.transitionTo('REQUESTED');

    await repository.save(first!, 0);

    await expect(repository.save(second!, 0)).rejects.toBeInstanceOf(ConflictError);
  });

  it('maps duplicate IDs to ConflictError', async () => {
    await repository.save(createJob('duplicate-job'), 0);

    await expect(repository.save(createJob('duplicate-job'), 0))
      .rejects.toBeInstanceOf(ConflictError);
  });
});
