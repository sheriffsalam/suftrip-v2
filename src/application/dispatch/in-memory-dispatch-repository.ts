import { DispatchJob } from '../../domain/dispatch/dispatch-job.js';
import { Provider } from '../../domain/dispatch/provider.js';
import type { DispatchAssignmentRepository } from './dispatch-repository.js';
import type { ProviderRepository } from './provider-repository.js';
import { ConflictError, DispatchAssignmentConflictError } from '../../shared/errors.js';

export class InMemoryDispatchJobRepository implements DispatchAssignmentRepository {
  private readonly records = new Map<string, ReturnType<DispatchJob['snapshot']>>();
  private readonly providers: Map<string, ReturnType<Provider['snapshot']>>;

  constructor(providers: Map<string, ReturnType<Provider['snapshot']>>) {
    this.providers = providers;
  }

  async getById(id: string): Promise<DispatchJob | null> {
    const record = this.records.get(id);
    return record ? DispatchJob.rehydrate(record) : null;
  }

  async getByDeliveryJobId(deliveryJobId: string): Promise<DispatchJob | null> {
    const record = [...this.records.values()].find(item => item.deliveryJobId === deliveryJobId);
    return record ? DispatchJob.rehydrate(record) : null;
  }

  async save(job: DispatchJob, expectedVersion: number): Promise<void> {
    const current = this.records.get(job.snapshot().id);
    if ((current?.version ?? 0) !== expectedVersion || (!current && expectedVersion !== 0)) {
      throw new ConflictError('DispatchJob version conflict');
    }
    this.records.set(job.snapshot().id, job.snapshot());
  }

  async assignProvider(job: DispatchJob, providerId: string, expectedVersion: number): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider || provider.availability !== 'AVAILABLE') {
      throw new DispatchAssignmentConflictError();
    }
    await this.save(job, expectedVersion);
    this.providers.set(providerId, Provider.rehydrate(provider).changeAvailability('BUSY').snapshot());
  }

  async releaseProvider(job: DispatchJob, providerId: string, expectedVersion: number): Promise<void> {
    await this.save(job, expectedVersion);
    const provider = this.providers.get(providerId);
    if (provider) this.providers.set(providerId, Provider.rehydrate(provider).changeAvailability('AVAILABLE').snapshot());
  }
}

export class InMemoryProviderRepository implements ProviderRepository {
  constructor(private readonly records = new Map<string, ReturnType<Provider['snapshot']>>()) {}

  async getById(id: string): Promise<Provider | null> {
    const record = this.records.get(id);
    return record ? Provider.rehydrate(record) : null;
  }

  async listAvailable(): Promise<readonly Provider[]> {
    return [...this.records.values()]
      .filter(record => record.availability === 'AVAILABLE')
      .map(record => Provider.rehydrate(record));
  }

  async save(provider: Provider, expectedVersion: number): Promise<void> {
    const current = this.records.get(provider.snapshot().id);
    if ((current?.version ?? 0) !== expectedVersion || (!current && expectedVersion !== 0)) {
      throw new ConflictError('Provider version conflict');
    }
    this.records.set(provider.snapshot().id, provider.snapshot());
  }

  values(): Map<string, ReturnType<Provider['snapshot']>> {
    return this.records;
  }
}

