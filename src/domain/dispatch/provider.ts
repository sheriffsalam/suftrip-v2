import { ValidationError } from '../../shared/errors.js';

export const PROVIDER_AVAILABILITIES = [
  'OFFLINE',
  'AVAILABLE',
  'BUSY',
  'SUSPENDED',
] as const;

export type ProviderAvailability = (typeof PROVIDER_AVAILABILITIES)[number];

export type ProviderSnapshot = Readonly<{
  id: string;
  availability: ProviderAvailability;
  location: Readonly<{
    latitude: number;
    longitude: number;
  }>;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export class Provider {
  private constructor(private readonly state: ProviderSnapshot) {}

  static create(input: Omit<ProviderSnapshot, 'version' | 'createdAt' | 'updatedAt'>): Provider {
    if (!input.id.trim()) throw new ValidationError('Provider id is required');
    validateCoordinates(input.location.latitude, input.location.longitude);
    const now = new Date().toISOString();
    return new Provider({ ...input, version: 0, createdAt: now, updatedAt: now });
  }

  static rehydrate(snapshot: ProviderSnapshot): Provider {
    if (!snapshot.id.trim()) throw new ValidationError('Provider id is required');
    validateCoordinates(snapshot.location.latitude, snapshot.location.longitude);
    return new Provider(snapshot);
  }

  snapshot(): ProviderSnapshot {
    return this.state;
  }

  changeAvailability(availability: ProviderAvailability): Provider {
    return new Provider({
      ...this.state,
      availability,
      version: this.state.version + 1,
      updatedAt: new Date().toISOString(),
    });
  }
}

function validateCoordinates(latitude: number, longitude: number): void {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new ValidationError('Provider latitude must be between -90 and 90');
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new ValidationError('Provider longitude must be between -180 and 180');
  }
}