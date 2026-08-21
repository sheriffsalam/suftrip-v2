import type { DeliveryJobRepository } from './delivery-job-repository.js';
import type { DeliveryStatus } from '../../domain/delivery/delivery-job.js';
import { NotFoundError } from '../../shared/errors.js';
import type { AuthenticatedPrincipal } from '../auth/authentication.js';
import { requireDeliveryAccess } from '../auth/authorization.js';

export type ChangeDeliveryStatusCommand = Readonly<{
  principal: AuthenticatedPrincipal;
  deliveryJobId: string;
  expectedVersion: number;
  nextStatus: DeliveryStatus;
}>;

export class ChangeDeliveryStatus {
  constructor(private readonly repository: DeliveryJobRepository) {}

  async execute(command: ChangeDeliveryStatusCommand): Promise<void> {
    const job = await this.repository.getById(command.deliveryJobId);
    if (!job) {
      throw new NotFoundError(
        `DeliveryJob not found: ${command.deliveryJobId}`,
      );
    }

    requireDeliveryAccess(command.principal, job.snapshot().requesterId);

    job.transitionTo(command.nextStatus);
    await this.repository.save(job, command.expectedVersion);
  }
}
