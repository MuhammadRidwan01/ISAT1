import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { getPool } from '../db/pool.js';
import { reportQuerySchema } from '../lib/schemas.js';

export default async function reportRoutes(app: FastifyInstance) {
  app.get('/api/report', async (req, reply) => {
    const parsed = reportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      reply.status(400);
      return { error: { code: 'validation_error', message: 'Invalid query', details: parsed.error.flatten() } };
    }
    const complexity = parsed.data.complexity;
    const pool = getPool();

    // 1. aggregates
    const revenueByCategoryRes = await pool.query(`
      SELECT p.category AS category, COALESCE(SUM(oi.quantity * oi.unit_price_cents),0)::bigint AS revenue_cents
      FROM products p
      LEFT JOIN order_items oi ON oi.product_id = p.id
      GROUP BY p.category
      ORDER BY p.category
    `);
    const revenuePerCategory = revenueByCategoryRes.rows.map((r: any) => ({
      category: r.category,
      revenueCents: Number(r.revenue_cents),
    }));

    const topProductsRes = await pool.query(`
      SELECT p.id, p.name, COALESCE(SUM(oi.quantity * oi.unit_price_cents),0)::bigint AS revenue_cents
      FROM products p
      LEFT JOIN order_items oi ON oi.product_id = p.id
      GROUP BY p.id, p.name
      ORDER BY revenue_cents DESC
      LIMIT 10
    `);
    const topProducts = topProductsRes.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      revenueCents: Number(r.revenue_cents),
    }));

    const revenuePerDayRes = await pool.query(`
      SELECT DATE(o.created_at) AS day, COALESCE(SUM(oi.quantity * oi.unit_price_cents),0)::bigint AS revenue_cents
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.created_at >= now() - interval '30 days'
      GROUP BY DATE(o.created_at)
      ORDER BY day
    `);
    const revenuePerDay = revenuePerDayRes.rows.map((r: any) => ({
      day: r.day,
      revenueCents: Number(r.revenue_cents),
    }));

    // 2. CPU workload
    const iterations = complexity * 200000;
    const buf = Buffer.alloc(1024, 7);
    const t0 = process.hrtime.bigint();
    let h: Buffer = buf;
    for (let i = 0; i < iterations; i++) {
      h = crypto.createHash('sha256').update(h).digest();
    }
    const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;

    return {
      aggregates: { revenuePerCategory, topProducts, revenuePerDay },
      cpu: { iterations, durationMs: Math.round(durationMs), checksum: h.toString('hex') },
    };
  });
}