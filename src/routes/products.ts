import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { productQuerySchema } from '../lib/schemas.js';

export default async function productRoutes(app: FastifyInstance) {
  app.get('/api/products', async (req, reply) => {
    const parsed = productQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      reply.status(400);
      return { error: { code: 'validation_error', message: 'Invalid query', details: parsed.error.flatten() } };
    }
    const { limit, offset, category } = parsed.data;
    const pool = getPool();
    const params: any[] = [];
    let where = '';
    if (category) {
      params.push(category);
      where = `WHERE category = $${params.length}`;
    }
    const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM products ${where}`, params);
    const total = countRes.rows[0].c as number;
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT id, sku, name, description, category, price_cents, stock FROM products ${where} ORDER BY id LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const items = rows.map((r: any) => ({
      id: r.id,
      sku: r.sku,
      name: r.name,
      description: r.description,
      category: r.category,
      priceCents: r.price_cents,
      stock: r.stock,
    }));
    return { items, total, limit, offset };
  });

  app.get('/api/products/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id) || id <= 0) {
      reply.status(400);
      return { error: { code: 'validation_error', message: 'Invalid id' } };
    }
    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT id, sku, name, description, category, price_cents, stock FROM products WHERE id = $1',
      [id]
    );
    if (rows.length === 0) {
      reply.status(404);
      return { error: { code: 'not_found', message: 'Product not found' } };
    }
    const r = rows[0];
    return {
      id: r.id,
      sku: r.sku,
      name: r.name,
      description: r.description,
      category: r.category,
      priceCents: r.price_cents,
      stock: r.stock,
    };
  });
}