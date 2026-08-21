import type { DispatchJob, DispatchJobSnapshot } from '../../domain/dispatch/dispatch-job.js';

export interface DispatchJobRepository {
  getById(id: string): Promise<DispatchJob | null>;
  getByDeliveryJobId(deliveryJobId: string): Promise<DispatchJob | null>;
  save(job: DispatchJob, expectedVersion: number): Promise<void>;
}

export interface DispatchAssignmentRepository extends DispatchJobRepository {
  assignProvider(
    job: DispatchJob,
    providerId: string,
    expectedVersion: number,
  ): Promise<void>;
  releaseProvider(
    job: DispatchJob,
    providerId: string,
    expectedVersion: number,
  ): Promise<void>;
}

export type DispatchJobRecord = DispatchJobSnapshot;