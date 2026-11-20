import { getPool, closePool } from "./pool.js";

async function main() {
  const pool = getPool();
  const res = await pool.query("DELETE FROM orders WHERE is_seed = false");
  console.log(`deleted ${res.rowCount} non-seed orders`);
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
