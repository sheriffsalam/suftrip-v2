import { describe, expect, it } from 'vitest';

import { DeliveryService } from '../../src/application/delivery/delivery-service.js';
import { InMemoryDeliveryJobRepository } from '../../src/application/delivery/in-memory-delivery-job-repository.js';
import { CreateDispatchJob } from '../../src/application/dispatch/create-dispatch-job.js';
import { AssignProvider } from '../../src/application/dispatch/assign-provider.js';
import { DispatchActions } from '../../src/application/dispatch/dispatch-actions.js';
import { InMemoryDispatchJobRepository, InMemoryProviderRepository } from '../../src/application/dispatch/in-memory-dispatch-repository.js';
import { Provider } from '../../src/domain/dispatch/provider.js';
import { AuthorizationError, ProviderUnavailableError } from '../../src/shared/errors.js';

const customer = { userId: 'customer-1', roles: ['CUSTOMER'] as const };
const otherCustomer = { userId: 'customer-2', roles: ['CUSTOMER'] as const };
const providerOne = { userId: 'provider-1', roles: ['PROVIDER'] as const };
const providerTwo = { userId: 'provider-2', roles: ['PROVIDER'] as const };

const command = {
  id: 'delivery-1',
  requesterId: 'ignored',
  pickup: { address: 'Pickup', latitude: 6.6, longitude: 3.35 },
  dropoff: { address: 'Dropoff', latitude: 6.4, longitude: 3.42 },
  deliveryType: 'PARCEL' as const,
};

async function setup() {
  const deliveryRepository = new InMemoryDeliveryJobRepository();
  const deliveryService = new DeliveryService(deliveryRepository);
  await deliveryService.create(customer, command);
  const providers = new InMemoryProviderRepository();
  await providers.save(Provider.create({
    id: 'provider-1', availability: 'AVAILABLE', location: { latitude: 6.6, longitude: 3.35 },
  }), 0);
  await providers.save(Provider.create({
    id: 'provider-2', availability: 'AVAILABLE', location: { latitude: 6.7, longitude: 3.45 },
  }), 0);
  const dispatchRepository = new InMemoryDispatchJobRepository(providers.values());
  const createDispatch = new CreateDispatchJob(deliveryRepository, dispatchRepository);
  const assignProvider = new AssignProvider(deliveryRepository, dispatchRepository, providers);
  const actions = new DispatchActions(deliveryRepository, dispatchRepository);
  return { deliveryRepository, deliveryService, providers, dispatchRepository, createDispatch, assignProvider, actions };
}

describe('dispatch application', () => {
  it('creates, assigns the nearest provider, and supports rejection redispatch', async () => {
    const { createDispatch, assignProvider, actions, providers } = await setup();
    await createDispatch.execute(customer, 'dispatch-1', 'delivery-1');

    const assigned = await assignProvider.execute(customer, 'dispatch-1');
    expect(assigned).toMatchObject({ status: 'PROVIDER_ASSIGNED', assignedProviderId: 'provider-1' });
    expect((await providers.getById('provider-1'))?.snapshot().availability).toBe('BUSY');

    const rejected = await actions.reject(providerOne, 'dispatch-1', 'provider-1');
    expect(rejected).toMatchObject({ status: 'PROVIDER_REJECTED', assignedProviderId: null });
    expect((await providers.getById('provider-1'))?.snapshot().availability).toBe('AVAILABLE');
  });

  it('accepts an assignment and rejects unavailable providers', async () => {
    const { createDispatch, assignProvider, actions, deliveryRepository, deliveryService, dispatchRepository, providers } = await setup();
    await createDispatch.execute(customer, 'dispatch-1', 'delivery-1');
    await assignProvider.execute(customer, 'dispatch-1', 'provider-1');
    await actions.reject(providerOne, 'dispatch-1', 'provider-1');
    await expect(assignProvider.execute(customer, 'dispatch-1', 'provider-2')).resolves.toMatchObject({ status: 'PROVIDER_ASSIGNED' });
    await expect(actions.accept(providerTwo, 'dispatch-1', 'provider-2')).resolves.toMatchObject({ status: 'PROVIDER_ACCEPTED' });

    const secondDispatch = new CreateDispatchJob(deliveryRepository, dispatchRepository);
    const secondAssignment = new AssignProvider(deliveryRepository, dispatchRepository, providers);
    await deliveryService.create(customer, { ...command, id: 'delivery-2' });
    await secondDispatch.execute(customer, 'dispatch-2', 'delivery-2');
    await expect(secondAssignment.execute(customer, 'dispatch-2', 'provider-2')).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('enforces ownership authorization', async () => {
    const { createDispatch, actions } = await setup();
    await createDispatch.execute(customer, 'dispatch-1', 'delivery-1');
    await expect(actions.get(otherCustomer, 'dispatch-1')).rejects.toBeInstanceOf(AuthorizationError);
  });
});
