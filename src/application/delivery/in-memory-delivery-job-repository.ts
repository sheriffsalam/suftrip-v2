import { DeliveryJob } from '../../domain/delivery/delivery-job.js';
import type { DeliveryJobRepository } from './delivery-job-repository.js';
import { ConflictError } from '../../shared/errors.js';

export class InMemoryDeliveryJobRepository implements DeliveryJobRepository {
  private readonly records = new Map<string, ReturnType<DeliveryJob['snapshot']>>();

  async getById(id: string): Promise<DeliveryJob | null> {
    const record = this.records.get(id);
    return record ? DeliveryJob.rehydrate(record) : null;
  }

  async save(job: DeliveryJob, expectedVersion: number): Promise<void> {
    const current = this.records.get(job.snapshot().id);

    if (current && current.version !== expectedVersion) {
      throw new ConflictError(
        `DeliveryJob version conflict: expected ${expectedVersion}, actual ${current.version}`,
      );
    }

    if (!current && expectedVersion !== 0) {
      throw new ConflictError(
        `DeliveryJob version conflict: expected ${expectedVersion}, actual 0`,
      );
    }

    if (current && job.snapshot().version === current.version) {
      throw new ConflictError(`DeliveryJob already exists: ${job.snapshot().id}`);
    }

    this.records.set(job.snapshot().id, job.snapshot());
  }
}
