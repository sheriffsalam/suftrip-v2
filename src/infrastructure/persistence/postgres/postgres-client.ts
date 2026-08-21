import { Pool } from 'pg';

export function createPostgresPool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is required for PostgreSQL persistence');
  }

  return new Pool({ connectionString });
}