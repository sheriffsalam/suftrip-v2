import type { Pool } from 'pg';

import type { ProviderRepository } from '../../../application/dispatch/provider-repository.js';
import { Provider, type ProviderSnapshot } from '../../../domain/dispatch/provider.js';
import { ConflictError } from '../../../shared/errors.js';

type ProviderRow = {
  id: string;
  availability: ProviderSnapshot['availability'];
  latitude: number;
  longitude: number;
  version: number;
  created_at: Date;
  updated_at: Date;
};

function toSnapshot(row: ProviderRow): ProviderSnapshot {
  return {
    id: row.id,
    availability: row.availability,
    location: { latitude: row.latitude, longitude: row.longitude },
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresProviderRepository implements ProviderRepository {
  constructor(private readonly pool: Pool) {}

  async getById(id: string): Promise<Provider | null> {
    const result = await this.pool.query<ProviderRow>(
      'SELECT id, availability, latitude, longitude, version, created_at, updated_at FROM providers WHERE id = $1',
      [id],
    );
    const row = result.rows[0];
    return row ? Provider.rehydrate(toSnapshot(row)) : null;
  }

  async listAvailable(): Promise<readonly Provider[]> {
    const result = await this.pool.query<ProviderRow>(
      'SELECT id, availability, latitude, longitude, version, created_at, updated_at FROM providers WHERE availability = $1 ORDER BY id',
      ['AVAILABLE'],
    );
    return result.rows.map(row => Provider.rehydrate(toSnapshot(row)));
  }

  async save(provider: Provider, expectedVersion: number): Promise<void> {
    const snapshot = provider.snapshot();
    if (snapshot.version === 0) {
      try {
        await this.pool.query(
          `INSERT INTO providers (id, availability, latitude, longitude, version, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [snapshot.id, snapshot.availability, snapshot.location.latitude, snapshot.location.longitude, snapshot.version, snapshot.createdAt, snapshot.updatedAt],
        );
      } catch (error: unknown) {
        if (isUniqueViolation(error)) throw new ConflictError(`Provider already exists: ${snapshot.id}`);
        throw error;
      }
      return;
    }

    const result = await this.pool.query(
      `UPDATE providers
          SET availability = $1, latitude = $2, longitude = $3,
              version = version + 1, updated_at = $4
        WHERE id = $5 AND version = $6`,
      [snapshot.availability, snapshot.location.latitude, snapshot.location.longitude, snapshot.updatedAt, snapshot.id, expectedVersion],
    );
    if (result.rowCount !== 1) throw new ConflictError('Provider version conflict');
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}