import type { Pool, PoolClient } from 'pg';

import type { DispatchAssignmentRepository } from '../../../application/dispatch/dispatch-repository.js';
import { DispatchJob, type DispatchJobSnapshot } from '../../../domain/dispatch/dispatch-job.js';
import { ConflictError, DispatchAssignmentConflictError } from '../../../shared/errors.js';

type DispatchRow = {
  id: string;
  delivery_job_id: string;
  status: DispatchJobSnapshot['status'];
  assigned_provider_id: string | null;
  attempt: number;
  version: number;
  created_at: Date;
  updated_at: Date;
};

function toSnapshot(row: DispatchRow): DispatchJobSnapshot {
  return {
    id: row.id,
    deliveryJobId: row.delivery_job_id,
    status: row.status,
    assignedProviderId: row.assigned_provider_id,
    attempt: row.attempt,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const SELECT = `SELECT id, delivery_job_id, status, assigned_provider_id,
  attempt, version, created_at, updated_at FROM dispatch_jobs`;

export class PostgresDispatchJobRepository implements DispatchAssignmentRepository {
  constructor(private readonly pool: Pool) {}

  async getById(id: string): Promise<DispatchJob | null> {
    const result = await this.pool.query<DispatchRow>(`${SELECT} WHERE id = $1`, [id]);
    const row = result.rows[0];
    return row ? DispatchJob.rehydrate(toSnapshot(row)) : null;
  }

  async getByDeliveryJobId(deliveryJobId: string): Promise<DispatchJob | null> {
    const result = await this.pool.query<DispatchRow>(`${SELECT} WHERE delivery_job_id = $1`, [deliveryJobId]);
    const row = result.rows[0];
    return row ? DispatchJob.rehydrate(toSnapshot(row)) : null;
  }

  async save(job: DispatchJob, expectedVersion: number): Promise<void> {
    const snapshot = job.snapshot();
    if (snapshot.version === 0) {
      try {
        await this.pool.query(
          `INSERT INTO dispatch_jobs (id, delivery_job_id, status, assigned_provider_id, attempt, version, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [snapshot.id, snapshot.deliveryJobId, snapshot.status, snapshot.assignedProviderId, snapshot.attempt, snapshot.version, snapshot.createdAt, snapshot.updatedAt],
        );
      } catch (error: unknown) {
        if (isUniqueViolation(error)) throw new ConflictError(`DispatchJob already exists: ${snapshot.id}`);
        throw error;
      }
      return;
    }
    const result = await this.pool.query(
      `UPDATE dispatch_jobs SET status = $1, assigned_provider_id = $2,
          attempt = $3, version = version + 1, updated_at = $4
        WHERE id = $5 AND version = $6`,
      [snapshot.status, snapshot.assignedProviderId, snapshot.attempt, snapshot.updatedAt, snapshot.id, expectedVersion],
    );
    if (result.rowCount !== 1) throw new ConflictError('DispatchJob version conflict');
  }

  async assignProvider(job: DispatchJob, providerId: string, expectedVersion: number): Promise<void> {
    await this.withTransaction(async client => {
      const provider = await client.query(
        `UPDATE providers SET availability = 'BUSY', version = version + 1, updated_at = $1
          WHERE id = $2 AND availability = 'AVAILABLE'`,
        [job.snapshot().updatedAt, providerId],
      );
      if (provider.rowCount !== 1) throw new DispatchAssignmentConflictError();
      await this.updateDispatch(client, job, expectedVersion);
    });
  }

  async releaseProvider(job: DispatchJob, providerId: string, expectedVersion: number): Promise<void> {
    await this.withTransaction(async client => {
      const provider = await client.query(
        `UPDATE providers SET availability = 'AVAILABLE', version = version + 1, updated_at = $1
          WHERE id = $2 AND availability = 'BUSY'`,
        [job.snapshot().updatedAt, providerId],
      );
      if (provider.rowCount !== 1) throw new DispatchAssignmentConflictError();
      await this.updateDispatch(client, job, expectedVersion);
    });
  }

  private async updateDispatch(client: PoolClient, job: DispatchJob, expectedVersion: number): Promise<void> {
    const snapshot = job.snapshot();
    const result = await client.query(
      `UPDATE dispatch_jobs SET status = $1, assigned_provider_id = $2,
          attempt = $3, version = version + 1, updated_at = $4
        WHERE id = $5 AND version = $6`,
      [snapshot.status, snapshot.assignedProviderId, snapshot.attempt, snapshot.updatedAt, snapshot.id, expectedVersion],
    );
    if (result.rowCount !== 1) throw new DispatchAssignmentConflictError();
  }

  private async withTransaction(action: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await action(client);
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}