import { Pool, type PoolConfig } from 'pg';
import { config } from '../config.js';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const cfg: PoolConfig = {
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    ssl: config.dbSsl ? { rejectUnauthorized: false } : false,
  };
  pool = new Pool(cfg);
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}