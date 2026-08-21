import {
  InvalidTransitionError,
  ValidationError,
} from '../../shared/errors.js';

export const DISPATCH_STATUSES = [
  'PENDING',
  'SEARCHING',
  'PROVIDER_ASSIGNED',
  'PROVIDER_ACCEPTED',
  'PROVIDER_REJECTED',
  'COMPLETED',
  'CANCELLED',
] as const;

export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

export type DispatchJobSnapshot = Readonly<{
  id: string;
  deliveryJobId: string;
  status: DispatchStatus;
  assignedProviderId: string | null;
  attempt: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type DispatchEvent =
  | Readonly<{ type: 'DispatchCreated'; dispatchJobId: string; deliveryJobId: string }>
  | Readonly<{ type: 'ProviderAssigned'; dispatchJobId: string; providerId: string }>
  | Readonly<{ type: 'ProviderAccepted'; dispatchJobId: string; providerId: string }>
  | Readonly<{ type: 'ProviderRejected'; dispatchJobId: string; providerId: string }>;

const TRANSITIONS: Readonly<Record<DispatchStatus, readonly DispatchStatus[]>> = {
  PENDING: ['SEARCHING', 'CANCELLED'],
  SEARCHING: ['PROVIDER_ASSIGNED', 'CANCELLED'],
  PROVIDER_ASSIGNED: ['PROVIDER_ACCEPTED', 'PROVIDER_REJECTED'],
  PROVIDER_ACCEPTED: ['COMPLETED'],
  PROVIDER_REJECTED: ['SEARCHING'],
  COMPLETED: [],
  CANCELLED: [],
};

export class InvalidDispatchTransitionError extends InvalidTransitionError {}

export class DispatchJob {
  private readonly events: DispatchEvent[] = [];

  private constructor(private state: DispatchJobSnapshot) {}

  static create(id: string, deliveryJobId: string): DispatchJob {
    if (!id.trim()) throw new ValidationError('DispatchJob id is required');
    if (!deliveryJobId.trim()) throw new ValidationError('DeliveryJob id is required');
    const now = new Date().toISOString();
    const job = new DispatchJob({
      id,
      deliveryJobId,
      status: 'PENDING',
      assignedProviderId: null,
      attempt: 0,
      version: 0,
      createdAt: now,
      updatedAt: now,
    });
    job.events.push({ type: 'DispatchCreated', dispatchJobId: id, deliveryJobId });
    return job;
  }

  static rehydrate(snapshot: DispatchJobSnapshot): DispatchJob {
    if (!snapshot.id.trim()) throw new ValidationError('DispatchJob id is required');
    if (!snapshot.deliveryJobId.trim()) throw new ValidationError('DeliveryJob id is required');
    if (snapshot.attempt < 0 || snapshot.version < 0) {
      throw new ValidationError('DispatchJob counters must be non-negative');
    }
    return new DispatchJob(snapshot);
  }

  assignProvider(providerId: string): void {
    if (!providerId.trim()) throw new ValidationError('Provider id is required');
    this.transitionTo('PROVIDER_ASSIGNED');
    this.state = { ...this.state, assignedProviderId: providerId };
    this.events.push({ type: 'ProviderAssigned', dispatchJobId: this.state.id, providerId });
  }

  accept(): void {
    this.transitionTo('PROVIDER_ACCEPTED');
    const providerId = this.requireAssignedProvider();
    this.events.push({ type: 'ProviderAccepted', dispatchJobId: this.state.id, providerId });
  }

  reject(): void {
    this.transitionTo('PROVIDER_REJECTED');
    const providerId = this.requireAssignedProvider();
    this.events.push({ type: 'ProviderRejected', dispatchJobId: this.state.id, providerId });
    this.state = { ...this.state, assignedProviderId: null };
  }

  startSearching(): void {
    this.transitionTo('SEARCHING');
  }

  complete(): void {
    this.transitionTo('COMPLETED');
  }

  cancel(): void {
    this.transitionTo('CANCELLED');
  }

  transitionTo(next: DispatchStatus): void {
    if (!TRANSITIONS[this.state.status].includes(next)) {
      throw new InvalidDispatchTransitionError(
        `Invalid DispatchJob transition: ${this.state.status} -> ${next}`,
      );
    }
    this.state = {
      ...this.state,
      status: next,
      attempt: next === 'PROVIDER_ASSIGNED' ? this.state.attempt + 1 : this.state.attempt,
      version: this.state.version + 1,
      updatedAt: new Date().toISOString(),
    };
  }

  snapshot(): DispatchJobSnapshot {
    return this.state;
  }

  pullEvents(): readonly DispatchEvent[] {
    return this.events.splice(0);
  }

  private requireAssignedProvider(): string {
    if (!this.state.assignedProviderId) {
      throw new ValidationError('DispatchJob has no assigned provider');
    }
    return this.state.assignedProviderId;
  }
}