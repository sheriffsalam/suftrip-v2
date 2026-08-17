import { describe, expect, it } from 'vitest';
import { DeliveryJob } from '../../../src/domain/delivery/delivery-job.js';
import { ChangeDeliveryStatus } from '../../../src/application/delivery/change-delivery-status.js';
import { InMemoryDeliveryJobRepository } from '../../../src/application/delivery/in-memory-delivery-job-repository.js';

describe('ChangeDeliveryStatus', () => {
  it('changes and persists a delivery job using the expected version', async () => {
    const repository = new InMemoryDeliveryJobRepository();
    const job = DeliveryJob.create('job-1');
    await repository.save(job, 0);

    const useCase = new ChangeDeliveryStatus(repository);
    await useCase.execute({
      deliveryJobId: 'job-1',
      expectedVersion: 0,
      nextStatus: 'REQUESTED',
    });

    await expect(repository.getById('job-1')).resolves.toMatchObject({
      // The repository returns a rehydrated aggregate; snapshot() verifies persistence state.
    });
    expect((await repository.getById('job-1'))?.snapshot()).toEqual({
      id: 'job-1',
      status: 'REQUESTED',
      version: 1,
    });
  });

  it('rejects a stale expected version', async () => {
    const repository = new InMemoryDeliveryJobRepository();
    await repository.save(DeliveryJob.create('job-1'), 0);

    const first = new ChangeDeliveryStatus(repository);
    await first.execute({
      deliveryJobId: 'job-1',
      expectedVersion: 0,
      nextStatus: 'REQUESTED',
    });

    const stale = new ChangeDeliveryStatus(repository);
    await expect(
      stale.execute({
        deliveryJobId: 'job-1',
        expectedVersion: 0,
        nextStatus: 'QUOTING',
      }),
    ).rejects.toThrow('DeliveryJob version conflict');

    expect((await repository.getById('job-1'))?.snapshot()).toEqual({
      id: 'job-1',
      status: 'REQUESTED',
      version: 1,
    });
  });

  it('fails when the delivery job does not exist', async () => {
    const useCase = new ChangeDeliveryStatus(new InMemoryDeliveryJobRepository());

    await expect(
      useCase.execute({
        deliveryJobId: 'missing-job',
        expectedVersion: 0,
        nextStatus: 'REQUESTED',
      }),
    ).rejects.toThrow('DeliveryJob not found: missing-job');
  });
});
