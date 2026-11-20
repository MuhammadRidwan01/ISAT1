import { getPool, closePool } from "./pool.js";

const CATEGORIES = [
  "books",
  "toys",
  "garden",
  "kitchen",
  "sports",
  "office",
  "music",
  "tools",
];

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
    await client.query("SET statement_timeout = '0'");
    await client.query("BEGIN");

    const { rows: prodCount } = await client.query(
      "SELECT COUNT(*)::int AS c FROM products",
    );
    if (prodCount[0].c === 0) {
      const r = rng(42);
      const placeholders: string[] = [];
      const params: any[] = [];
      let idx = 1;
      for (let i = 1; i <= 1000; i++) {
        const cat = CATEGORIES[(i - 1) % CATEGORIES.length];
        const price = 500 + Math.floor(r() * 9500);
        const stock = 50 + Math.floor(r() * 150);
        placeholders.push(
          `($${idx},$${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5})`,
        );
        params.push(
          `SKU-${String(i).padStart(5, "0")}`,
          `Product ${i}`,
          `Description of product ${i}`,
          cat,
          price,
          stock,
        );
        idx += 6;
      }
      await client.query(
        `INSERT INTO products (sku, name, description, category, price_cents, stock) VALUES ${placeholders.join(",")}`,
        params,
      );
      console.log("seeded 1000 products");
    } else {
      console.log(`products already present (${prodCount[0].c}), skipping`);
    }

    const { rows: seedOrders } = await client.query(
      "SELECT COUNT(*)::int AS c FROM orders WHERE is_seed = true",
    );
    if (seedOrders[0].c === 0) {
      const { rows: prodRows } = await client.query(
        "SELECT id, price_cents FROM products",
      );
      const priceMap = new Map<number, number>();
      const productIds = prodRows.map((p: any) => p.id as number);
      for (const pr of prodRows)
        priceMap.set(pr.id as number, pr.price_cents as number);

      const r = rng(7);
      const now = Date.now();
      const orderData: {
        custN: number;
        total: number;
        ts: Date;
        items: { pid: number; qty: number; price: number }[];
      }[] = [];
      for (let o = 0; o < 5000; o++) {
        const daysAgo = Math.floor(r() * 90);
        const ts = new Date(
          now - daysAgo * 24 * 60 * 60 * 1000 - Math.floor(r() * 86400000),
        );
        if (ts.getTime() > now) ts.setTime(now);
        const custN = 1 + Math.floor(r() * 5000);
        const itemCount = 1 + Math.floor(r() * 5);
        const chosen = new Set<number>();
        while (chosen.size < itemCount)
          chosen.add(productIds[Math.floor(r() * productIds.length)]);
        let total = 0;
        const items: { pid: number; qty: number; price: number }[] = [];
        for (const pid of chosen) {
          const price = priceMap.get(pid)!;
          const qty = 1 + Math.floor(r() * 5);
          total += price * qty;
          items.push({ pid, qty, price });
        }
        orderData.push({ custN, total, ts, items });
      }

      // batch insert orders
      const BATCH = 500;
      const orderIdByIndex: number[] = new Array(orderData.length);
      for (let b = 0; b < orderData.length; b += BATCH) {
        const slice = orderData.slice(b, b + BATCH);
        const placeholders: string[] = [];
        const params: any[] = [];
        let idx = 1;
        for (const od of slice) {
          placeholders.push(
            `($${idx},$${idx + 1},$${idx + 2},'confirmed',true,$${idx + 3})`,
          );
          params.push(
            `Customer ${od.custN}`,
            `seed${od.custN}@example.com`,
            od.total,
            od.ts.toISOString(),
          );
          idx += 4;
        }
        const res = await client.query(
          `INSERT INTO orders (customer_name, customer_email, total_cents, status, is_seed, created_at) VALUES ${placeholders.join(",")} RETURNING id`,
          params,
        );
        for (let i = 0; i < slice.length; i++) {
          orderIdByIndex[b + i] = res.rows[i].id as number;
        }
      }

      // batch insert order_items
      const allItems: {
        orderId: number;
        pid: number;
        qty: number;
        price: number;
      }[] = [];
      for (let i = 0; i < orderData.length; i++) {
        for (const it of orderData[i].items) {
          allItems.push({
            orderId: orderIdByIndex[i],
            pid: it.pid,
            qty: it.qty,
            price: it.price,
          });
        }
      }
      const ITEM_BATCH = 1000;
      for (let b = 0; b < allItems.length; b += ITEM_BATCH) {
        const slice = allItems.slice(b, b + ITEM_BATCH);
        const placeholders: string[] = [];
        const params: any[] = [];
        let idx = 1;
        for (const it of slice) {
          placeholders.push(`($${idx},$${idx + 1},$${idx + 2},$${idx + 3})`);
          params.push(it.orderId, it.pid, it.qty, it.price);
          idx += 4;
        }
        await client.query(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES ${placeholders.join(",")}`,
          params,
        );
      }

      console.log("seeded 5000 orders");
    } else {
      console.log(`seed orders already present (${seedOrders[0].c}), skipping`);
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
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
