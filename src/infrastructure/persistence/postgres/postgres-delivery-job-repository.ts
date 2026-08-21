import type { Pool } from 'pg';

import type { DeliveryJobRepository } from '../../../application/delivery/delivery-job-repository.js';
import {
  DeliveryJob,
  type DeliveryJobSnapshot,
} from '../../../domain/delivery/delivery-job.js';
import { ConflictError } from '../../../shared/errors.js';

type DeliveryJobRow = {
  id: string;
  requester_id: string;
  pickup_address: string;
  pickup_latitude: number;
  pickup_longitude: number;
  dropoff_address: string;
  dropoff_latitude: number;
  dropoff_longitude: number;
  delivery_type: DeliveryJobSnapshot['deliveryType'];
  status: DeliveryJobSnapshot['status'];
  version: number;
  created_at: Date;
  updated_at: Date;
};

function toSnapshot(row: DeliveryJobRow): DeliveryJobSnapshot {
  return {
    id: row.id,
    requesterId: row.requester_id,
    pickup: {
      address: row.pickup_address,
      latitude: row.pickup_latitude,
      longitude: row.pickup_longitude,
    },
    dropoff: {
      address: row.dropoff_address,
      latitude: row.dropoff_latitude,
      longitude: row.dropoff_longitude,
    },
    deliveryType: row.delivery_type,
    status: row.status,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresDeliveryJobRepository implements DeliveryJobRepository {
  constructor(private readonly pool: Pool) {}

  async getById(id: string): Promise<DeliveryJob | null> {
    const result = await this.pool.query<DeliveryJobRow>(
      `SELECT id, requester_id, pickup_address, pickup_latitude,
              pickup_longitude, dropoff_address, dropoff_latitude,
              dropoff_longitude, delivery_type, status, version,
              created_at, updated_at
         FROM delivery_jobs
        WHERE id = $1`,
      [id],
    );

    const row = result.rows[0];
    return row ? DeliveryJob.rehydrate(toSnapshot(row)) : null;
  }

  async save(job: DeliveryJob, expectedVersion: number): Promise<void> {
    const snapshot = job.snapshot();

    if (snapshot.version === 0) {
      try {
        await this.pool.query(
          `INSERT INTO delivery_jobs (
             id, requester_id, pickup_address, pickup_latitude,
             pickup_longitude, dropoff_address, dropoff_latitude,
             dropoff_longitude, delivery_type, status, version,
             created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            snapshot.id,
            snapshot.requesterId,
            snapshot.pickup.address,
            snapshot.pickup.latitude,
            snapshot.pickup.longitude,
            snapshot.dropoff.address,
            snapshot.dropoff.latitude,
            snapshot.dropoff.longitude,
            snapshot.deliveryType,
            snapshot.status,
            snapshot.version,
            snapshot.createdAt,
            snapshot.updatedAt,
          ],
        );
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          throw new ConflictError(`DeliveryJob already exists: ${snapshot.id}`);
        }
        throw error;
      }
      return;
    }

    const result = await this.pool.query(
      `UPDATE delivery_jobs
          SET status = $1, version = version + 1, updated_at = $2
        WHERE id = $3 AND version = $4`,
      [snapshot.status, snapshot.updatedAt, snapshot.id, expectedVersion],
    );

    if (result.rowCount !== 1) {
      throw new ConflictError(
        `DeliveryJob version conflict: expected ${expectedVersion}`,
      );
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505';
}