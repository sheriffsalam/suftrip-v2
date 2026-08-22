import type { AuthenticatedPrincipal } from '../auth/authentication.js';
import { requireDeliveryAccess, requireRole } from '../auth/authorization.js';
import type { DeliveryJobRepository } from '../delivery/delivery-job-repository.js';
import { DispatchAssignmentConflictError, NotFoundError, ProviderUnavailableError } from '../../shared/errors.js';
import type { DispatchJob } from '../../domain/dispatch/dispatch-job.js';
import type { DispatchAssignmentRepository } from './dispatch-repository.js';
import type { ProviderRepository } from './provider-repository.js';
import { FindDispatchCandidate } from './find-dispatch-candidate.js';

export class AssignProvider {
  private readonly findCandidate: FindDispatchCandidate;

  constructor(
    private readonly deliveries: DeliveryJobRepository,
    private readonly dispatches: DispatchAssignmentRepository,
    private readonly providers: ProviderRepository,
  ) {
    this.findCandidate = new FindDispatchCandidate(deliveries, dispatches, providers);
  }

  async execute(
    principal: AuthenticatedPrincipal,
    dispatchJobId: string,
    requestedProviderId?: string,
  ): Promise<ReturnType<DispatchJob['snapshot']>> {
    const dispatch = await this.dispatches.getById(dispatchJobId);
    if (!dispatch) throw new NotFoundError(`DispatchJob not found: ${dispatchJobId}`);
    const delivery = await this.deliveries.getById(dispatch.snapshot().deliveryJobId);
    if (!delivery) throw new NotFoundError(`DeliveryJob not found: ${dispatch.snapshot().deliveryJobId}`);
    requireDeliveryAccess(principal, delivery.snapshot().requesterId);

    if (requestedProviderId) {
      requireRole(principal, 'ADMIN');
    }

    const current = dispatch.snapshot();
    if (current.status === 'PROVIDER_ASSIGNED') {
      if (!requestedProviderId || current.assignedProviderId === requestedProviderId) {
        return current;
      }
      throw new DispatchAssignmentConflictError('DispatchJob already has a different provider assigned');
    }

    if (current.status === 'PROVIDER_REJECTED') {
      const previousVersion = current.version;
      dispatch.startSearching();
      await this.dispatches.save(dispatch, previousVersion);
    }
    if (dispatch.snapshot().status !== 'SEARCHING') {
      throw new DispatchAssignmentConflictError('DispatchJob is not searching for a provider');
    }

    const provider = requestedProviderId
      ? await this.providers.getById(requestedProviderId)
      : await this.findCandidate.execute(dispatchJobId);
    if (!provider || provider.snapshot().availability !== 'AVAILABLE') {
      throw new ProviderUnavailableError();
    }

    const providerId = provider.snapshot().id;
    const expectedVersion = dispatch.snapshot().version;
    dispatch.assignProvider(providerId);
    try {
      await this.dispatches.assignProvider(dispatch, providerId, expectedVersion);
    } catch (error: unknown) {
      if (error instanceof DispatchAssignmentConflictError) throw error;
      throw new DispatchAssignmentConflictError();
    }
    return dispatch.snapshot();
  }
}
