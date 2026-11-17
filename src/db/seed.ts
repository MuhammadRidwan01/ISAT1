import { getPool, closePool } from './pool.js';

const CATEGORIES = ['books', 'toys', 'garden', 'kitchen', 'sports', 'office', 'music', 'tools'];

// Deterministic PRNG (mulberry32)
function rng(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: prodCount } = await client.query('SELECT COUNT(*)::int AS c FROM products');
    if (prodCount[0].c === 0) {
      const r = rng(42);
      for (let i = 1; i <= 1000; i++) {
        const cat = CATEGORIES[(i - 1) % CATEGORIES.length];
        const price = 500 + Math.floor(r() * 9500);
        const stock = 50 + Math.floor(r() * 150);
        await client.query(
          `INSERT INTO products (sku, name, description, category, price_cents, stock)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [`SKU-${String(i).padStart(5, '0')}`, `Product ${i}`, `Description of product ${i}`, cat, price, stock]
        );
      }
      console.log('seeded 1000 products');
    } else {
      console.log(`products already present (${prodCount[0].c}), skipping`);
    }

    const { rows: seedOrders } = await client.query('SELECT COUNT(*)::int AS c FROM orders WHERE is_seed = true');
    if (seedOrders[0].c === 0) {
      const r = rng(7);
      const now = Date.now();
      const ninetyDays = 90 * 24 * 60 * 60 * 1000;
      for (let o = 0; o < 5000; o++) {
        const daysAgo = Math.floor(r() * 90);
        const ts = new Date(now - daysAgo * 24 * 60 * 60 * 1000 - Math.floor(r() * 86400000));
        if (ts.getTime() > now) ts.setTime(now);
        const custN = 1 + Math.floor(r() * 5000);
        const itemCount = 1 + Math.floor(r() * 5);
        const chosen = new Set<number>();
        while (chosen.size < itemCount) chosen.add(1 + Math.floor(r() * 1000));
        let total = 0;
        const items: { pid: number; qty: number; price: number }[] = [];
        for (const pid of chosen) {
          const { rows } = await client.query('SELECT price_cents FROM products WHERE id = $1', [pid]);
          const price = rows[0].price_cents as number;
          const qty = 1 + Math.floor(r() * 5);
          total += price * qty;
          items.push({ pid, qty, price });
        }
        const { rows: or } = await client.query(
          `INSERT INTO orders (customer_name, customer_email, total_cents, status, is_seed, created_at)
           VALUES ($1,$2,$3,'confirmed',true,$4) RETURNING id`,
          [`Customer ${custN}`, `seed${custN}@example.com`, total, ts.toISOString()]
        );
        const orderId = or[0].id as number;
        for (const it of items) {
          await client.query(
            `INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES ($1,$2,$3,$4)`,
            [orderId, it.pid, it.qty, it.price]
          );
        }
      }
      console.log('seeded 5000 orders');
    } else {
      console.log(`seed orders already present (${seedOrders[0].c}), skipping`);
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});