import { describe, expect, it } from 'vitest';
import {
  DeliveryJob,
  InvalidDeliveryTransitionError,
} from '../../src/domain/delivery/delivery-job.js';

describe('DeliveryJob', () => {
  it('starts in DRAFT', () => {
    expect(DeliveryJob.create('job-1').snapshot()).toEqual({
      id: 'job-1',
      status: 'DRAFT',
      version: 0,
    });
  });

  it('allows the documented happy-path lifecycle', () => {
    const job = DeliveryJob.create('job-1');
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

    expect(job.snapshot()).toEqual({
      id: 'job-1',
      status: 'DELIVERED',
      version: 9,
    });
  });

  it('rejects invalid lifecycle transitions', () => {
    const job = DeliveryJob.create('job-1');
    expect(() => job.transitionTo('DELIVERED')).toThrow(InvalidDeliveryTransitionError);
  });

  it('emits a domain event for a successful transition', () => {
    const job = DeliveryJob.create('job-1');
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
    const requested = DeliveryJob.create('job-1');
    requested.transitionTo('REQUESTED');
    requested.transitionTo('CANCELLED');

    const quoting = DeliveryJob.create('job-2');
    quoting.transitionTo('REQUESTED');
    quoting.transitionTo('QUOTING');
    quoting.transitionTo('CANCELLED');

    const booked = DeliveryJob.create('job-3');
    booked.transitionTo('REQUESTED');
    booked.transitionTo('QUOTING');
    booked.transitionTo('BOOKED');
    booked.transitionTo('CANCELLED');

    expect(requested.snapshot().status).toBe('CANCELLED');
    expect(quoting.snapshot().status).toBe('CANCELLED');
    expect(booked.snapshot().status).toBe('CANCELLED');
  });
});
