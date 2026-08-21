import type { AuthenticatedPrincipal } from '../auth/authentication.js';
import { requireDeliveryAccess } from '../auth/authorization.js';
import type { DeliveryJobRepository } from '../delivery/delivery-job-repository.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import { DispatchJob } from '../../domain/dispatch/dispatch-job.js';
import type { DispatchJobRepository } from './dispatch-repository.js';

export class CreateDispatchJob {
  constructor(
    private readonly deliveries: DeliveryJobRepository,
    private readonly dispatches: DispatchJobRepository,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    dispatchJobId: string,
    deliveryJobId: string,
  ): Promise<ReturnType<DispatchJob['snapshot']>> {
    const delivery = await this.deliveries.getById(deliveryJobId);
    if (!delivery) throw new NotFoundError(`DeliveryJob not found: ${deliveryJobId}`);
    requireDeliveryAccess(principal, delivery.snapshot().requesterId);

    if (await this.dispatches.getByDeliveryJobId(deliveryJobId)) {
      throw new ConflictError(`DispatchJob already exists for delivery: ${deliveryJobId}`);
    }

    const job = DispatchJob.create(dispatchJobId, deliveryJobId);
    await this.dispatches.save(job, 0);
    job.startSearching();
    await this.dispatches.save(job, 0);
    return job.snapshot();
  }
}