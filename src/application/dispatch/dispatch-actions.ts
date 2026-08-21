import type { AuthenticatedPrincipal } from '../auth/authentication.js';
import { requireDeliveryAccess, requireProviderAccess } from '../auth/authorization.js';
import type { DeliveryJobRepository } from '../delivery/delivery-job-repository.js';
import { DispatchAssignmentConflictError, NotFoundError } from '../../shared/errors.js';
import type { DispatchAssignmentRepository } from './dispatch-repository.js';

export class DispatchActions {
  constructor(
    private readonly deliveries: DeliveryJobRepository,
    private readonly dispatches: DispatchAssignmentRepository,
  ) {}

  async get(principal: AuthenticatedPrincipal, dispatchJobId: string) {
    const dispatch = await this.dispatches.getById(dispatchJobId);
    if (!dispatch) throw new NotFoundError(`DispatchJob not found: ${dispatchJobId}`);
    const delivery = await this.deliveries.getById(dispatch.snapshot().deliveryJobId);
    if (!delivery) throw new NotFoundError(`DeliveryJob not found: ${dispatch.snapshot().deliveryJobId}`);
    requireDeliveryAccess(principal, delivery.snapshot().requesterId);
    return dispatch.snapshot();
  }

  async accept(principal: AuthenticatedPrincipal, dispatchJobId: string, providerId: string) {
    const dispatch = await this.dispatches.getById(dispatchJobId);
    if (!dispatch) throw new NotFoundError(`DispatchJob not found: ${dispatchJobId}`);
    const delivery = await this.deliveries.getById(dispatch.snapshot().deliveryJobId);
    if (!delivery) throw new NotFoundError(`DeliveryJob not found: ${dispatch.snapshot().deliveryJobId}`);
    if (dispatch.snapshot().assignedProviderId !== providerId) throw new DispatchAssignmentConflictError();
    requireProviderAccess(principal, providerId);
    if (dispatch.snapshot().status === 'PROVIDER_ACCEPTED') return dispatch.snapshot();
    dispatch.accept();
    await this.dispatches.save(dispatch, dispatch.snapshot().version - 1);
    return dispatch.snapshot();
  }

  async reject(principal: AuthenticatedPrincipal, dispatchJobId: string, providerId: string) {
    const dispatch = await this.dispatches.getById(dispatchJobId);
    if (!dispatch) throw new NotFoundError(`DispatchJob not found: ${dispatchJobId}`);
    const delivery = await this.deliveries.getById(dispatch.snapshot().deliveryJobId);
    if (!delivery) throw new NotFoundError(`DeliveryJob not found: ${dispatch.snapshot().deliveryJobId}`);
    if (dispatch.snapshot().assignedProviderId !== providerId) throw new DispatchAssignmentConflictError();
    requireProviderAccess(principal, providerId);
    dispatch.reject();
    await this.dispatches.releaseProvider(dispatch, providerId, dispatch.snapshot().version - 1);
    return dispatch.snapshot();
  }

  async cancel(principal: AuthenticatedPrincipal, dispatchJobId: string) {
    const dispatch = await this.dispatches.getById(dispatchJobId);
    if (!dispatch) throw new NotFoundError(`DispatchJob not found: ${dispatchJobId}`);
    const delivery = await this.deliveries.getById(dispatch.snapshot().deliveryJobId);
    if (!delivery) throw new NotFoundError(`DeliveryJob not found: ${dispatch.snapshot().deliveryJobId}`);
    requireDeliveryAccess(principal, delivery.snapshot().requesterId);
    const providerId = dispatch.snapshot().assignedProviderId;
    dispatch.cancel();
    if (providerId) await this.dispatches.releaseProvider(dispatch, providerId, dispatch.snapshot().version - 1);
    else await this.dispatches.save(dispatch, dispatch.snapshot().version - 1);
    return dispatch.snapshot();
  }
}