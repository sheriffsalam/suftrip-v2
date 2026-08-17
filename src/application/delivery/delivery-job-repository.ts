import type { DeliveryJob, DeliveryJobSnapshot } from '../../domain/delivery/delivery-job.js';

export interface DeliveryJobRepository {
  getById(id: string): Promise<DeliveryJob | null>;
  save(job: DeliveryJob, expectedVersion: number): Promise<void>;
}

export type DeliveryJobRecord = DeliveryJobSnapshot;
