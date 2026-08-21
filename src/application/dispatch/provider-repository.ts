import type { Provider, ProviderSnapshot } from '../../domain/dispatch/provider.js';

export interface ProviderRepository {
  getById(id: string): Promise<Provider | null>;
  listAvailable(): Promise<readonly Provider[]>;
  save(provider: Provider, expectedVersion: number): Promise<void>;
}

export type ProviderRecord = ProviderSnapshot;