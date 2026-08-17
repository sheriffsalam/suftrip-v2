import type { DeliveryJobRepository } from './delivery-job-repository.js';
import type { DeliveryStatus } from '../../domain/delivery/delivery-job.js';

export type ChangeDeliveryStatusCommand = Readonly<{
  deliveryJobId: string;
  expectedVersion: number;
  nextStatus: DeliveryStatus;
}>;

export class ChangeDeliveryStatus {
  constructor(private readonly repository: DeliveryJobRepository) {}

  async execute(command: ChangeDeliveryStatusCommand): Promise<void> {
    const job = await this.repository.getById(command.deliveryJobId);
    if (!job) throw new Error(`DeliveryJob not found: ${command.deliveryJobId}`);

    job.transitionTo(command.nextStatus);
    await this.repository.save(job, command.expectedVersion);
  }
}
