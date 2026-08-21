import { describe, expect, it } from 'vitest';
import { DeliveryService } from '../../../src/application/delivery/delivery-service.js';
import { InMemoryDeliveryJobRepository } from '../../../src/application/delivery/in-memory-delivery-job-repository.js';

const customer = { userId: 'requester-1', roles: ['CUSTOMER'] as const };

const createCommand = (id = 'job-1') => ({
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
  deliveryType: 'PARCEL' as const,
});

describe('DeliveryService', () => {
  it('creates a delivery job', async () => {
    const repository = new InMemoryDeliveryJobRepository();
    const service = new DeliveryService(repository);

    await expect(service.create(customer, createCommand())).resolves.toMatchObject({
      id: 'job-1',
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
      status: 'DRAFT',
      version: 0,
    });
  });

  it('gets an existing delivery job', async () => {
    const repository = new InMemoryDeliveryJobRepository();
    const service = new DeliveryService(repository);

    await service.create(customer, createCommand());

    await expect(service.get(customer, 'job-1')).resolves.toMatchObject({
      id: 'job-1',
      requesterId: 'requester-1',
      deliveryType: 'PARCEL',
      status: 'DRAFT',
      version: 0,
    });
  });

  it('returns null when the delivery job does not exist', async () => {
    const repository = new InMemoryDeliveryJobRepository();
    const service = new DeliveryService(repository);

    await expect(service.get(customer, 'missing-job')).resolves.toBeNull();
  });

  it('rejects duplicate delivery job IDs', async () => {
    const repository = new InMemoryDeliveryJobRepository();
    const service = new DeliveryService(repository);

    await service.create(customer, createCommand());

    await expect(service.create(customer, createCommand())).rejects.toThrow(
      'DeliveryJob already exists: job-1',
    );
  });
});