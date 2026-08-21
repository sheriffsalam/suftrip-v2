import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DeliveryJob } from '../../src/domain/delivery/delivery-job.js';
import { Provider } from '../../src/domain/dispatch/provider.js';
import { CreateDispatchJob } from '../../src/application/dispatch/create-dispatch-job.js';
import { AssignProvider } from '../../src/application/dispatch/assign-provider.js';
import { DispatchActions } from '../../src/application/dispatch/dispatch-actions.js';
import { PostgresDispatchJobRepository } from '../../src/infrastructure/persistence/postgres/postgres-dispatch-repository.js';
import { PostgresDeliveryJobRepository } from '../../src/infrastructure/persistence/postgres/postgres-delivery-job-repository.js';
import { PostgresProviderRepository } from '../../src/infrastructure/persistence/postgres/postgres-provider-repository.js';
import { createPostgresPool } from '../../src/infrastructure/persistence/postgres/postgres-client.js';
import { migrate } from '../../src/infrastructure/persistence/postgres/migrate.js';
import { ConflictError, DispatchAssignmentConflictError, ProviderUnavailableError } from '../../src/shared/errors.js';

const integration = describe.skipIf(!process.env.DATABASE_URL);
const customer = { userId: 'dispatch-customer', roles: ['CUSTOMER'] as const };
const admin = { userId: 'dispatch-admin', roles: ['ADMIN'] as const };
const providerOne = { userId: 'provider-1', roles: ['PROVIDER'] as const };

function delivery(id: string) {
  return DeliveryJob.create({
    id,
    requesterId: customer.userId,
    pickup: { address: 'Pickup', latitude: 6.6, longitude: 3.35 },
    dropoff: { address: 'Dropoff', latitude: 6.4, longitude: 3.42 },
    deliveryType: 'PARCEL',
  });
}

integration('PostgreSQL dispatch persistence', () => {
  let pool: Pool;
  let deliveries: PostgresDeliveryJobRepository;
  let dispatches: PostgresDispatchJobRepository;
  let providers: PostgresProviderRepository;

  beforeAll(async () => {
    pool = createPostgresPool();
    await migrate(pool);
    dispatches = new PostgresDispatchJobRepository(pool);
    providers = new PostgresProviderRepository(pool);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM dispatch_jobs');
    await pool.query('DELETE FROM providers');
    await pool.query('DELETE FROM delivery_jobs');
    deliveries = new PostgresDeliveryJobRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createDelivery(id: string): Promise<void> {
    const job = delivery(id);
    await deliveries.save(job, 0);
  }

  async function createProvider(id: string, latitude = 6.6): Promise<void> {
    await providers.save(Provider.create({
      id,
      availability: 'AVAILABLE',
      location: { latitude, longitude: 3.35 },
    }), 0);
  }

  it('persists and rehydrates a searching dispatch across repository instances', async () => {
    await createDelivery('dispatch-delivery-1');
    const create = new CreateDispatchJob(deliveries, dispatches);
    const created = await create.execute(customer, 'dispatch-1', 'dispatch-delivery-1');
    const freshRepository = new PostgresDispatchJobRepository(pool);
    const retrieved = await freshRepository.getById('dispatch-1');

    expect(created).toMatchObject({ status: 'SEARCHING', version: 1, attempt: 0 });
    expect(retrieved?.snapshot()).toMatchObject({
      id: 'dispatch-1',
      deliveryJobId: 'dispatch-delivery-1',
      status: 'SEARCHING',
      version: 1,
    });
  });

  it('assigns, accepts, releases, and redispatches providers', async () => {
    await createDelivery('dispatch-delivery-2');
    await createProvider('provider-1', 6.6);
    await createProvider('provider-2', 6.7);
    const create = new CreateDispatchJob(deliveries, dispatches);
    const assign = new AssignProvider(deliveries, dispatches, providers);
    const actions = new DispatchActions(deliveries, dispatches);
    await create.execute(customer, 'dispatch-2', 'dispatch-delivery-2');

    const assigned = await assign.execute(customer, 'dispatch-2');
    expect(assigned.assignedProviderId).toBe('provider-1');
    expect((await providers.getById('provider-1'))?.snapshot().availability).toBe('BUSY');

    const rejected = await actions.reject(providerOne, 'dispatch-2', 'provider-1');
    expect(rejected).toMatchObject({ status: 'PROVIDER_REJECTED', assignedProviderId: null });
    expect((await providers.getById('provider-1'))?.snapshot().availability).toBe('AVAILABLE');

    const redispatched = await assign.execute(customer, 'dispatch-2');
    expect(redispatched.assignedProviderId).toBe('provider-1');
    await actions.accept(admin, 'dispatch-2', 'provider-1');
    expect((await dispatches.getById('dispatch-2'))?.snapshot().status).toBe('PROVIDER_ACCEPTED');
  });

  it('allows exactly one concurrent assignment to a provider', async () => {
    await createDelivery('concurrent-delivery-1');
    await createDelivery('concurrent-delivery-2');
    await createProvider('single-provider');
    const create = new CreateDispatchJob(deliveries, dispatches);
    const assign = new AssignProvider(deliveries, dispatches, providers);
    await create.execute(customer, 'concurrent-dispatch-1', 'concurrent-delivery-1');
    await create.execute(customer, 'concurrent-dispatch-2', 'concurrent-delivery-2');

    const results = await Promise.allSettled([
      assign.execute(customer, 'concurrent-dispatch-1'),
      assign.execute(customer, 'concurrent-dispatch-2'),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const failure = results.find(result => result.status === 'rejected');
    expect(failure && [DispatchAssignmentConflictError, ProviderUnavailableError].some(type => failure.reason instanceof type)).toBe(true);
    expect((await providers.getById('single-provider'))?.snapshot().availability).toBe('BUSY');
  });

  it('rejects duplicate dispatches without changing the original', async () => {
    await createDelivery('duplicate-dispatch-delivery');
    const create = new CreateDispatchJob(deliveries, dispatches);
    await create.execute(customer, 'duplicate-dispatch-1', 'duplicate-dispatch-delivery');

    await expect(create.execute(customer, 'duplicate-dispatch-2', 'duplicate-dispatch-delivery'))
      .rejects.toBeInstanceOf(ConflictError);
    expect((await dispatches.getByDeliveryJobId('duplicate-dispatch-delivery'))?.snapshot().id)
      .toBe('duplicate-dispatch-1');
  });
});

