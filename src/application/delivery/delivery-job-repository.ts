import type { DeliveryEvent, DeliveryJob, DeliveryJobSnapshot } from '../../domain/delivery/delivery-job.js';

export interface DeliveryJobRepository {
  getById(id: string): Promise<DeliveryJob | null>;
  save(job: DeliveryJob, expectedVersion: number, events?: readonly DeliveryEvent[]): Promise<void>;
}

export type DeliveryJobRecord = DeliveryJobSnapshot;
