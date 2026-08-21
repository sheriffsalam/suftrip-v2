import type { AuthenticatedPrincipal } from '../auth/authentication.js';
import { requireRole } from '../auth/authorization.js';
import { Provider, type ProviderSnapshot } from '../../domain/dispatch/provider.js';
import type { ProviderRepository } from './provider-repository.js';

export class CreateProvider {
  constructor(private readonly providers: ProviderRepository) {}

  async execute(
    principal: AuthenticatedPrincipal,
    input: Pick<ProviderSnapshot, 'id' | 'availability' | 'location'>,
  ): Promise<ProviderSnapshot> {
    requireRole(principal, 'ADMIN');
    const provider = Provider.create(input);
    await this.providers.save(provider, 0);
    return provider.snapshot();
  }
}