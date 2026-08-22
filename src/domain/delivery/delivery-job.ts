export const DELIVERY_STATUSES = [
  'DRAFT',
  'REQUESTED',
  'QUOTING',
  'BOOKED',
  'SEARCHING_FOR_PROVIDER',
  'PROVIDER_ASSIGNED',
  'PROVIDER_ACCEPTED',
  'ARRIVING_FOR_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
  'ARRIVING',
  'DELIVERED',
  'CANCELLED',
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_TYPES = [
  'PARCEL',
  'FOOD',
  'DOCUMENT',
  'OTHER',
] as const;

export type DeliveryType = (typeof DELIVERY_TYPES)[number];

export type DeliveryLocation = Readonly<{
  address: string;
  latitude: number;
  longitude: number;
}>;

export type DeliveryEvent = {
  readonly type: 'DeliveryJobStatusChanged';
  readonly deliveryJobId: string;
  readonly from: DeliveryStatus;
  readonly to: DeliveryStatus;
};

export type DeliveryJobSnapshot = Readonly<{
  id: string;
  requesterId: string;
  pickup: DeliveryLocation;
  dropoff: DeliveryLocation;
  deliveryType: DeliveryType;
  status: DeliveryStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

import {
  InvalidTransitionError,
  ValidationError,
} from '../../shared/errors.js';

export type CreateDeliveryJobInput = Readonly<{
  id: string;
  requesterId: string;
  pickup: DeliveryLocation;
  dropoff: DeliveryLocation;
  deliveryType: DeliveryType;
}>;

export class InvalidDeliveryTransitionError extends InvalidTransitionError {
  constructor(from: DeliveryStatus, to: DeliveryStatus) {
    super(`Invalid DeliveryJob transition: ${from} -> ${to}`);
    this.name = 'InvalidDeliveryTransitionError';
  }
}

const TRANSITIONS: Readonly<
  Record<DeliveryStatus, readonly DeliveryStatus[]>
> = {
  DRAFT: ['REQUESTED'],
  REQUESTED: ['QUOTING', 'SEARCHING_FOR_PROVIDER', 'CANCELLED'],
  QUOTING: ['BOOKED', 'CANCELLED'],
  BOOKED: ['PROVIDER_ASSIGNED', 'CANCELLED'],
  SEARCHING_FOR_PROVIDER: ['PROVIDER_ASSIGNED'],
  PROVIDER_ASSIGNED: ['PROVIDER_ACCEPTED'],
  PROVIDER_ACCEPTED: ['ARRIVING_FOR_PICKUP'],
  ARRIVING_FOR_PICKUP: ['PICKED_UP'],
  PICKED_UP: ['IN_TRANSIT'],
  IN_TRANSIT: ['ARRIVING'],
  ARRIVING: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

function validateLocation(
  location: DeliveryLocation,
  name: string,
): void {
  if (!location.address.trim()) {
    throw new ValidationError(`${name}.address is required`);
  }

  if (
    !Number.isFinite(location.latitude) ||
    location.latitude < -90 ||
    location.latitude > 90
  ) {
    throw new ValidationError(`${name}.latitude must be between -90 and 90`);
  }

  if (
    !Number.isFinite(location.longitude) ||
    location.longitude < -180 ||
    location.longitude > 180
  ) {
    throw new ValidationError(`${name}.longitude must be between -180 and 180`);
  }
}

export class DeliveryJob {
  private readonly events: DeliveryEvent[] = [];

  private constructor(
    private readonly id: string,
    private readonly requesterId: string,
    private readonly pickup: DeliveryLocation,
    private readonly dropoff: DeliveryLocation,
    private readonly deliveryType: DeliveryType,
    private status: DeliveryStatus,
    private version: number,
    private readonly createdAt: string,
    private updatedAt: string,
  ) {}

  static create(input: CreateDeliveryJobInput): DeliveryJob {
    if (!input.id.trim()) {
      throw new ValidationError('DeliveryJob id is required');
    }

    if (!input.requesterId.trim()) {
      throw new ValidationError('DeliveryJob requesterId is required');
    }

    if (!DELIVERY_TYPES.includes(input.deliveryType)) {
      throw new ValidationError(
        `Invalid deliveryType: ${String(input.deliveryType)}`,
      );
    }

    validateLocation(input.pickup, 'pickup');
    validateLocation(input.dropoff, 'dropoff');

    const now = new Date().toISOString();

    return new DeliveryJob(
      input.id,
      input.requesterId,
      input.pickup,
      input.dropoff,
      input.deliveryType,
      'DRAFT',
      0,
      now,
      now,
    );
  }

  static rehydrate(snapshot: DeliveryJobSnapshot): DeliveryJob {
    if (!snapshot.id.trim()) {
      throw new ValidationError('DeliveryJob id is required');
    }

    if (!snapshot.requesterId.trim()) {
      throw new ValidationError('DeliveryJob requesterId is required');
    }

    if (!DELIVERY_TYPES.includes(snapshot.deliveryType)) {
      throw new ValidationError(
        `Invalid deliveryType: ${String(snapshot.deliveryType)}`,
      );
    }

    validateLocation(snapshot.pickup, 'pickup');
    validateLocation(snapshot.dropoff, 'dropoff');

    return new DeliveryJob(
      snapshot.id,
      snapshot.requesterId,
      snapshot.pickup,
      snapshot.dropoff,
      snapshot.deliveryType,
      snapshot.status,
      snapshot.version,
      snapshot.createdAt,
      snapshot.updatedAt,
    );
  }

  transitionTo(next: DeliveryStatus): void {
    if (!TRANSITIONS[this.status].includes(next)) {
      throw new InvalidDeliveryTransitionError(
        this.status,
        next,
      );
    }

    const previous = this.status;

    this.status = next;
    this.version += 1;
    this.updatedAt = new Date().toISOString();

    this.events.push({
      type: 'DeliveryJobStatusChanged',
      deliveryJobId: this.id,
      from: previous,
      to: next,
    });
  }

  snapshot(): DeliveryJobSnapshot {
    return {
      id: this.id,
      requesterId: this.requesterId,
      pickup: this.pickup,
      dropoff: this.dropoff,
      deliveryType: this.deliveryType,
      status: this.status,
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  pullEvents(): readonly DeliveryEvent[] {
    const pending = this.events.splice(0);
    return pending;
  }
}
