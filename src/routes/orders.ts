import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { createOrderSchema } from '../lib/schemas.js';

export default async function orderRoutes(app: FastifyInstance) {
  app.post('/api/orders', async (req, reply) => {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: { code: 'validation_error', message: 'Invalid order', details: parsed.error.flatten() } };
    }
    const { customerName, customerEmail, items } = parsed.data;
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // load prices
      const priceMap = new Map<number, number>();
      for (const it of items) {
        const { rows } = await client.query('SELECT price_cents FROM products WHERE id = $1', [it.productId]);
        if (rows.length === 0) {
          await client.query('ROLLBACK');
          reply.status(422);
          return { error: { code: 'unknown_product', message: `Unknown productId ${it.productId}` } };
        }
        priceMap.set(it.productId, rows[0].price_cents as number);
      }
      let total = 0;
      const orderItems = items.map((it) => {
        const price = priceMap.get(it.productId)!;
        total += price * it.quantity;
        return { productId: it.productId, quantity: it.quantity, unitPriceCents: price };
      });
      const { rows: or } = await client.query(
        `INSERT INTO orders (customer_name, customer_email, total_cents, status, is_seed)
         VALUES ($1,$2,$3,'confirmed',false) RETURNING id, created_at`,
        [customerName, customerEmail, total]
      );
      const orderId = or[0].id as number;
      const createdAt = or[0].created_at as Date;
      for (const it of orderItems) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES ($1,$2,$3,$4)`,
          [orderId, it.productId, it.quantity, it.unitPriceCents]
        );
      }
      await client.query('COMMIT');
      reply.status(201);
      return {
        id: orderId,
        status: 'confirmed',
        totalCents: total,
        createdAt: createdAt.toISOString(),
        items: orderItems,
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  app.get('/api/orders/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id) || id <= 0) {
      reply.status(400);
      return { error: { code: 'validation_error', message: 'Invalid id' } };
    }
    const pool = getPool();
    const { rows: or } = await pool.query(
      'SELECT id, total_cents, status, created_at FROM orders WHERE id = $1',
      [id]
    );
    if (or.length === 0) {
      reply.status(404);
      return { error: { code: 'not_found', message: 'Order not found' } };
    }
    const o = or[0];
    const { rows: items } = await pool.query(
      'SELECT product_id, quantity, unit_price_cents FROM order_items WHERE order_id = $1 ORDER BY id',
      [id]
    );
    return {
      id: o.id,
      status: o.status,
      totalCents: o.total_cents,
      createdAt: (o.created_at as Date).toISOString(),
      items: items.map((r: any) => ({
        productId: r.product_id,
        quantity: r.quantity,
        unitPriceCents: r.unit_price_cents,
      })),
    };
  });
}