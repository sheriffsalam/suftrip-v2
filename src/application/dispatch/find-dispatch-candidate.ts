import type { DeliveryJobRepository } from '../delivery/delivery-job-repository.js';
import { NotFoundError, ProviderUnavailableError } from '../../shared/errors.js';
import { selectNearestProvider } from '../../domain/dispatch/dispatch-policy.js';
import type { ProviderRepository } from './provider-repository.js';
import type { DispatchJobRepository } from './dispatch-repository.js';
import type { Provider } from '../../domain/dispatch/provider.js';

export class FindDispatchCandidate {
  constructor(
    private readonly deliveries: DeliveryJobRepository,
    private readonly dispatches: DispatchJobRepository,
    private readonly providers: ProviderRepository,
  ) {}

  async execute(dispatchJobId: string): Promise<Provider> {
    const dispatch = await this.dispatches.getById(dispatchJobId);
    if (!dispatch) throw new NotFoundError(`DispatchJob not found: ${dispatchJobId}`);
    const delivery = await this.deliveries.getById(dispatch.snapshot().deliveryJobId);
    if (!delivery) throw new NotFoundError(`DeliveryJob not found: ${dispatch.snapshot().deliveryJobId}`);
    const provider = selectNearestProvider(
      delivery.snapshot().pickup,
      (await this.providers.listAvailable()).map(item => item.snapshot()),
    );
    if (!provider) throw new ProviderUnavailableError();
    const selected = await this.providers.getById(provider.id);
    if (!selected) throw new ProviderUnavailableError();
    return selected;
  }
}