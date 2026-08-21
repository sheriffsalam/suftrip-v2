import { describe, expect, it } from 'vitest';

import { DispatchJob, InvalidDispatchTransitionError } from '../../src/domain/dispatch/dispatch-job.js';
import { Provider } from '../../src/domain/dispatch/provider.js';
import { selectNearestProvider } from '../../src/domain/dispatch/dispatch-policy.js';

const pickup = {
  address: 'Ikeja, Lagos',
  latitude: 6.6018,
  longitude: 3.3515,
};

function createProvider(id: string, availability: 'AVAILABLE' | 'BUSY' = 'AVAILABLE', latitude = 6.6018) {
  return Provider.create({
    id,
    availability,
    location: { latitude, longitude: 3.3515 },
  });
}

describe('DispatchJob', () => {
  it('supports assignment, rejection, redispatch, acceptance, and completion', () => {
    const job = DispatchJob.create('dispatch-1', 'delivery-1');
    expect(job.snapshot()).toMatchObject({ status: 'PENDING', version: 0, attempt: 0 });

    job.startSearching();
    job.assignProvider('provider-1');
    job.reject();
    job.startSearching();
    job.assignProvider('provider-2');
    job.accept();
    job.complete();

    expect(job.snapshot()).toMatchObject({
      status: 'COMPLETED',
      assignedProviderId: 'provider-2',
      version: 7,
      attempt: 2,
    });
  });

  it('rejects invalid and terminal transitions', () => {
    const job = DispatchJob.create('dispatch-1', 'delivery-1');

    expect(() => job.accept()).toThrow(InvalidDispatchTransitionError);
    job.cancel();
    expect(() => job.startSearching()).toThrow(InvalidDispatchTransitionError);
  });

  it('emits dispatch events', () => {
    const job = DispatchJob.create('dispatch-1', 'delivery-1');
    job.startSearching();
    job.assignProvider('provider-1');
    job.accept();

    expect(job.pullEvents()).toEqual([
      { type: 'DispatchCreated', dispatchJobId: 'dispatch-1', deliveryJobId: 'delivery-1' },
      { type: 'ProviderAssigned', dispatchJobId: 'dispatch-1', providerId: 'provider-1' },
      { type: 'ProviderAccepted', dispatchJobId: 'dispatch-1', providerId: 'provider-1' },
    ]);
  });
});

describe('dispatch policy', () => {
  it('selects the nearest available provider and ties by ID', () => {
    const selected = selectNearestProvider(pickup, [
      createProvider('z-provider', 'AVAILABLE', 6.6018).snapshot(),
      createProvider('a-provider', 'AVAILABLE', 6.6018).snapshot(),
      createProvider('near-provider', 'AVAILABLE', 6.6028).snapshot(),
      createProvider('busy-provider', 'BUSY', 6.6018).snapshot(),
    ]);

    expect(selected?.id).toBe('a-provider');
  });

  it('returns null when no provider is eligible', () => {
    expect(selectNearestProvider(pickup, [createProvider('busy', 'BUSY').snapshot()])).toBeNull();
  });
});
