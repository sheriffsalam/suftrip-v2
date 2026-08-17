import { DeliveryJob, type DeliveryStatus } from '../../domain/delivery/delivery-job.js';
import type { DeliveryJobRepository } from './delivery-job-repository.js';
import { ChangeDeliveryStatus } from './change-delivery-status.js';

export type CreateDeliveryJobCommand = Readonly<{ id: string }>;

export class DeliveryService {
  private readonly changeStatusUseCase: ChangeDeliveryStatus;

  constructor(private readonly repository: DeliveryJobRepository) {
    this.changeStatusUseCase = new ChangeDeliveryStatus(repository);
  }

  async create(command: CreateDeliveryJobCommand): Promise<ReturnType<DeliveryJob['snapshot']>> {
    const existing = await this.repository.getById(command.id);
    if (existing) throw new Error(`DeliveryJob already exists: ${command.id}`);

    const job = DeliveryJob.create(command.id);
    await this.repository.save(job, 0);
    return job.snapshot();
  }

  async get(id: string): Promise<ReturnType<DeliveryJob['snapshot']> | null> {
    const job = await this.repository.getById(id);
    return job?.snapshot() ?? null;
  }

  async changeStatus(
    deliveryJobId: string,
    expectedVersion: number,
    nextStatus: DeliveryStatus,
  ): Promise<ReturnType<DeliveryJob['snapshot']>> {
    await this.changeStatusUseCase.execute({ deliveryJobId, expectedVersion, nextStatus });
    const job = await this.repository.getById(deliveryJobId);
    if (!job) throw new Error(`DeliveryJob not found after update: ${deliveryJobId}`);
    return job.snapshot();
  }
}
