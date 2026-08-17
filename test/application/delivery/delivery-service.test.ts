import { describe, expect, it } from 'vitest';
import { DeliveryService } from '../../../src/application/delivery/delivery-service.js';
import { InMemoryDeliveryJobRepository } from '../../../src/application/delivery/in-memory-delivery-job-repository.js';

describe('DeliveryService', () => {
  it('creates and retrieves a delivery job', async () => {
    const service = new DeliveryService(new InMemoryDeliveryJobRepository());

    await expect(service.create({ id: 'job-1' })).resolves.toEqual({
      id: 'job-1',
      status: 'DRAFT',
      version: 0,
    });

    await expect(service.get('job-1')).resolves.toEqual({
      id: 'job-1',
      status: 'DRAFT',
      version: 0,
    });
  });

  it('rejects duplicate delivery job creation', async () => {
    const service = new DeliveryService(new InMemoryDeliveryJobRepository());
    await service.create({ id: 'job-1' });

    await expect(service.create({ id: 'job-1' })).rejects.toThrow(
      'DeliveryJob already exists: job-1',
    );
  });

  it('changes status through the application boundary', async () => {
    const service = new DeliveryService(new InMemoryDeliveryJobRepository());
    await service.create({ id: 'job-1' });

    await expect(service.changeStatus('job-1', 0, 'REQUESTED')).resolves.toEqual({
      id: 'job-1',
      status: 'REQUESTED',
      version: 1,
    });
  });

  it('returns null for an unknown delivery job', async () => {
    const service = new DeliveryService(new InMemoryDeliveryJobRepository());
    await expect(service.get('missing')).resolves.toBeNull();
  });
});
