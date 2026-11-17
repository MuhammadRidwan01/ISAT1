import { describe, it, expect } from 'vitest';
import { createOrderSchema, productQuerySchema, reportQuerySchema } from '../../src/lib/schemas.js';
import { calculateTotal } from '../../src/lib/order-total.js';

describe('validation', () => {
  it('accepts valid order', () => {
    const r = createOrderSchema.safeParse({
      customerName: 'Rian',
      customerEmail: 'r@x.com',
      items: [{ productId: 1, quantity: 2 }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty items', () => {
    const r = createOrderSchema.safeParse({ customerName: 'R', customerEmail: 'r@x.com', items: [] });
    expect(r.success).toBe(false);
  });

  it('rejects duplicate productId', () => {
    const r = createOrderSchema.safeParse({
      customerName: 'R',
      customerEmail: 'r@x.com',
      items: [{ productId: 1, quantity: 1 }, { productId: 1, quantity: 2 }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects bad email', () => {
    const r = createOrderSchema.safeParse({ customerName: 'R', customerEmail: 'nope', items: [{ productId: 1, quantity: 1 }] });
    expect(r.success).toBe(false);
  });

  it('validates product query defaults', () => {
    const r = productQuerySchema.parse({});
    expect(r.limit).toBe(20);
    expect(r.offset).toBe(0);
  });

  it('rejects limit > 100', () => {
    const r = productQuerySchema.safeParse({ limit: 200 });
    expect(r.success).toBe(false);
  });

  it('validates report complexity', () => {
    expect(reportQuerySchema.parse({}).complexity).toBe(3);
    expect(reportQuerySchema.safeParse({ complexity: 0 }).success).toBe(false);
    expect(reportQuerySchema.safeParse({ complexity: 11 }).success).toBe(false);
  });

  it('calculateTotal', () => {
    expect(calculateTotal([{ unitPriceCents: 100, quantity: 2 }, { unitPriceCents: 50, quantity: 3 }])).toBe(350);
  });
});