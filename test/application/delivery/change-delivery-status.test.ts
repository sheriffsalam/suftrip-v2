import { describe, expect, it } from 'vitest';
import { DeliveryJob } from '../../../src/domain/delivery/delivery-job.js';
import { ChangeDeliveryStatus } from '../../../src/application/delivery/change-delivery-status.js';
import { InMemoryDeliveryJobRepository } from '../../../src/application/delivery/in-memory-delivery-job-repository.js';

const customer = { userId: 'requester-1', roles: ['CUSTOMER'] as const };

function createJob(id = 'job-1') {
  return DeliveryJob.create({
    id,
    requesterId: 'requester-1',
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

describe('ChangeDeliveryStatus', () => {
  it('changes status when expected version matches', async () => {
    const repository = new InMemoryDeliveryJobRepository();

    await repository.save(createJob(), 0);

    const useCase = new ChangeDeliveryStatus(repository);

    await useCase.execute({
      principal: customer,
      deliveryJobId: 'job-1',
      expectedVersion: 0,
      nextStatus: 'REQUESTED',
    });

    const job = await repository.getById('job-1');

    expect(job?.snapshot().status).toBe('REQUESTED');
    expect(job?.snapshot().version).toBe(1);
  });

  it('rejects stale versions', async () => {
    const repository = new InMemoryDeliveryJobRepository();

    await repository.save(createJob(), 0);

    const useCase = new ChangeDeliveryStatus(repository);

    await useCase.execute({
      principal: customer,
      deliveryJobId: 'job-1',
      expectedVersion: 0,
      nextStatus: 'REQUESTED',
    });

    await expect(
      useCase.execute({
        principal: customer,
        deliveryJobId: 'job-1',
        expectedVersion: 0,
        nextStatus: 'QUOTING',
      }),
    ).rejects.toThrow('version conflict');
  });

  it('rejects invalid lifecycle transitions', async () => {
    const repository = new InMemoryDeliveryJobRepository();

    await repository.save(createJob(), 0);

    const useCase = new ChangeDeliveryStatus(repository);

    await expect(
      useCase.execute({
        principal: customer,
        deliveryJobId: 'job-1',
        expectedVersion: 0,
        nextStatus: 'DELIVERED',
      }),
    ).rejects.toThrow('Invalid DeliveryJob transition');
  });
});