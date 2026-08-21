import { describe, expect, it } from 'vitest';
import {
  DeliveryJob,
  InvalidDeliveryTransitionError,
} from '../../src/domain/delivery/delivery-job.js';

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

describe('DeliveryJob', () => {
  it('starts in DRAFT', () => {
    const snapshot = createJob().snapshot();

    expect(snapshot.id).toBe('job-1');
    expect(snapshot.requesterId).toBe('requester-1');
    expect(snapshot.deliveryType).toBe('PARCEL');
    expect(snapshot.status).toBe('DRAFT');
    expect(snapshot.version).toBe(0);
    expect(snapshot.createdAt).toBeTruthy();
    expect(snapshot.updatedAt).toBeTruthy();
  });

  it('stores pickup and dropoff locations', () => {
    const snapshot = createJob().snapshot();

    expect(snapshot.pickup).toEqual({
      address: 'Ikeja, Lagos',
      latitude: 6.6018,
      longitude: 3.3515,
    });

    expect(snapshot.dropoff).toEqual({
      address: 'Victoria Island, Lagos',
      latitude: 6.4281,
      longitude: 3.4219,
    });
  });

  it('allows the documented happy-path lifecycle', () => {
    const job = createJob();

    for (const status of [
      'REQUESTED',
      'SEARCHING_FOR_PROVIDER',
      'PROVIDER_ASSIGNED',
      'PROVIDER_ACCEPTED',
      'ARRIVING_FOR_PICKUP',
      'PICKED_UP',
      'IN_TRANSIT',
      'ARRIVING',
      'DELIVERED',
    ] as const) {
      job.transitionTo(status);
    }

    expect(job.snapshot().status).toBe('DELIVERED');
    expect(job.snapshot().version).toBe(9);
  });

  it('rejects invalid lifecycle transitions', () => {
    const job = createJob();

    expect(() => job.transitionTo('DELIVERED')).toThrow(
      InvalidDeliveryTransitionError,
    );
  });

  it('emits a domain event for a successful transition', () => {
    const job = createJob();

    job.transitionTo('REQUESTED');

    expect(job.pullEvents()).toEqual([
      {
        type: 'DeliveryJobStatusChanged',
        deliveryJobId: 'job-1',
        from: 'DRAFT',
        to: 'REQUESTED',
      },
    ]);

    expect(job.pullEvents()).toEqual([]);
  });

  it('supports the explicitly documented cancellation paths', () => {
    const requested = createJob('job-1');
    requested.transitionTo('REQUESTED');
    requested.transitionTo('CANCELLED');

    const quoting = createJob('job-2');
    quoting.transitionTo('REQUESTED');
    quoting.transitionTo('QUOTING');
    quoting.transitionTo('CANCELLED');

    const booked = createJob('job-3');
    booked.transitionTo('REQUESTED');
    booked.transitionTo('QUOTING');
    booked.transitionTo('BOOKED');
    booked.transitionTo('CANCELLED');

    expect(requested.snapshot().status).toBe('CANCELLED');
    expect(quoting.snapshot().status).toBe('CANCELLED');
    expect(booked.snapshot().status).toBe('CANCELLED');
  });

  it('rejects invalid locations', () => {
    expect(() =>
      DeliveryJob.create({
        id: 'job-invalid',
        requesterId: 'requester-1',
        pickup: {
          address: '',
          latitude: 6.6018,
          longitude: 3.3515,
        },
        dropoff: {
          address: 'Victoria Island, Lagos',
          latitude: 6.4281,
          longitude: 3.4219,
        },
        deliveryType: 'PARCEL',
      }),
    ).toThrow('pickup.address is required');
  });
});