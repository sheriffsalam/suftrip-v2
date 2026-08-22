import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

import { createPostgresPool } from './postgres-client.js';

const migrationPaths = [
  ['001-create-delivery-jobs', 'src/infrastructure/persistence/postgres/migrations/001-create-delivery-jobs.sql'],
  ['002-create-dispatch', 'src/infrastructure/persistence/postgres/migrations/002-create-dispatch.sql'],
  ['003-create-payments', 'src/infrastructure/persistence/postgres/migrations/003-create-payments.sql'],
  ['004-create-notifications', 'src/infrastructure/persistence/postgres/migrations/004-create-notifications.sql'],
] as const;

export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL
      )
    `);

    for (const [version, relativePath] of migrationPaths) {
      const result = await client.query(
        'SELECT 1 FROM schema_migrations WHERE version = $1',
        [version],
      );
      if (result.rowCount === 0) {
        const migration = await readFile(resolve(process.cwd(), relativePath), 'utf8');
        await client.query(migration);
        await client.query(
          'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)',
          [version, new Date().toISOString()],
        );
      }
    }

    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith('migrate.js')) {
  const pool = createPostgresPool();
  migrate(pool)
    .then(() => pool.end())
    .catch(async error => {
      console.error('Database migration failed');
      await pool.end();
      process.exitCode = 1;
      throw error;
    });
}
