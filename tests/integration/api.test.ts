import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { app } from '../../src/server.js';

process.env.NODE_ENV = 'test';

describe('integration', () => {
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.status).toBe('ok');
    expect(res.headers['x-instance-id']).toBeTruthy();
    expect(res.headers['server-timing']).toContain('app;dur=');
  });

  it('health/db', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/db' });
    expect(res.statusCode).toBe(200);
    expect(res.json().db).toBe('ok');
  });

  it('categories', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/categories' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('products list + detail + 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/products?limit=5&offset=0' });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.items.length).toBe(5);
    expect(typeof b.total).toBe('number');
    const d = await app.inject({ method: 'GET', url: `/api/products/${b.items[0].id}` });
    expect(d.statusCode).toBe(200);
    const nf = await app.inject({ method: 'GET', url: '/api/products/999999' });
    expect(nf.statusCode).toBe(404);
  });

  it('products filter category', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/products?category=books&limit=10' });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.items.every((i: any) => i.category === 'books')).toBe(true);
  });

  it('create order + get order', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: { customerName: 'Test', customerEmail: 't@x.com', items: [{ productId: 1, quantity: 2 }] },
    });
    expect(res.statusCode).toBe(201);
    const b = res.json();
    expect(b.status).toBe('confirmed');
    const g = await app.inject({ method: 'GET', url: `/api/orders/${b.id}` });
    expect(g.statusCode).toBe(200);
    expect(g.json().items.length).toBe(1);
  });

  it('create order unknown product -> 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: { customerName: 'Test', customerEmail: 't@x.com', items: [{ productId: 999999, quantity: 1 }] },
    });
    expect(res.statusCode).toBe(422);
  });

  it('create order validation -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: { customerName: '', customerEmail: 'bad', items: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('report', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/report?complexity=2' });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.cpu.iterations).toBe(400000);
    expect(typeof b.cpu.checksum).toBe('string');
    expect(Array.isArray(b.aggregates.revenuePerCategory)).toBe(true);
  });
});