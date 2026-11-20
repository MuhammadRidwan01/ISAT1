import { getPool } from "../db/pool.js";
export default async function categoryRoutes(app) {
  app.get("/api/categories", async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT DISTINCT category FROM products ORDER BY category",
    );
    return rows.map((r) => r.category);
  });
}
