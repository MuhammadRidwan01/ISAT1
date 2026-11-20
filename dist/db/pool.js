import { Pool } from "pg";
import { config } from "../config.js";
let pool = null;
export function getPool() {
  if (pool) return pool;
  const cfg = {
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    ssl: config.dbSsl ? { rejectUnauthorized: false } : false,
  };
  pool = new Pool(cfg);
  return pool;
}
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
