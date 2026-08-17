import { DeliveryJob } from '../../domain/delivery/delivery-job.js';
import type { DeliveryJobRepository } from './delivery-job-repository.js';

export class InMemoryDeliveryJobRepository implements DeliveryJobRepository {
  private readonly records = new Map<string, ReturnType<DeliveryJob['snapshot']>>();

  async getById(id: string): Promise<DeliveryJob | null> {
    const record = this.records.get(id);
    return record ? DeliveryJob.rehydrate(record) : null;
  }

  async save(job: DeliveryJob, expectedVersion: number): Promise<void> {
    const current = this.records.get(job.snapshot().id);

    if (current && current.version !== expectedVersion) {
      throw new Error(
        `DeliveryJob version conflict: expected ${expectedVersion}, actual ${current.version}`,
      );
    }

    if (!current && expectedVersion !== 0) {
      throw new Error(
        `DeliveryJob version conflict: expected ${expectedVersion}, actual 0`,
      );
    }

    this.records.set(job.snapshot().id, job.snapshot());
  }
}
