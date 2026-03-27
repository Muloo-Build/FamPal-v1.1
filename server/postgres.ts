import pg, { type QueryResultRow } from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || '';

export const isPostgresEnabled = connectionString.length > 0;

const pool = isPostgresEnabled
  ? new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
    })
  : null;

export async function pgQuery<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  if (!pool) {
    throw new Error('postgres_not_configured');
  }
  return pool.query<T>(text, params);
}

export async function pgHealthCheck(): Promise<boolean> {
  if (!pool) return false;
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePostgresPool(): Promise<void> {
  if (!pool) return;
  await pool.end();
}
