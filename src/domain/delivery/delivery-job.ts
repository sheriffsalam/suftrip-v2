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

export type DeliveryEvent = {
  readonly type: 'DeliveryJobStatusChanged';
  readonly deliveryJobId: string;
  readonly from: DeliveryStatus;
  readonly to: DeliveryStatus;
};

export class InvalidDeliveryTransitionError extends Error {
  constructor(from: DeliveryStatus, to: DeliveryStatus) {
    super(`Invalid DeliveryJob transition: ${from} -> ${to}`);
    this.name = 'InvalidDeliveryTransitionError';
  }
}

const TRANSITIONS: Readonly<Record<DeliveryStatus, readonly DeliveryStatus[]>> = {
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

export type DeliveryJobSnapshot = Readonly<{
  id: string;
  status: DeliveryStatus;
  version: number;
}>;

export class DeliveryJob {
  private readonly events: DeliveryEvent[] = [];

  private constructor(
    private readonly id: string,
    private status: DeliveryStatus,
    private version: number,
  ) {}

  static create(id: string): DeliveryJob {
    if (!id.trim()) throw new Error('DeliveryJob id is required');
    return new DeliveryJob(id, 'DRAFT', 0);
  }

  static rehydrate(snapshot: DeliveryJobSnapshot): DeliveryJob {
    if (!snapshot.id.trim()) throw new Error('DeliveryJob id is required');
    return new DeliveryJob(snapshot.id, snapshot.status, snapshot.version);
  }

  transitionTo(next: DeliveryStatus): void {
    if (!TRANSITIONS[this.status].includes(next)) {
      throw new InvalidDeliveryTransitionError(this.status, next);
    }

    const previous = this.status;
    this.status = next;
    this.version += 1;
    this.events.push({
      type: 'DeliveryJobStatusChanged',
      deliveryJobId: this.id,
      from: previous,
      to: next,
    });
  }

  snapshot(): DeliveryJobSnapshot {
    return { id: this.id, status: this.status, version: this.version };
  }

  pullEvents(): readonly DeliveryEvent[] {
    const pending = this.events.splice(0);
    return pending;
  }
}
