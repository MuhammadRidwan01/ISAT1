const state = { offset: 0, limit: 10, category: "", total: 0, cart: [] };
const $ = (id) => document.getElementById(id);

async function api(path, opts) {
  const t0 = performance.now();
  const res = await fetch(path, opts);
  const ms = Math.round(performance.now() - t0);
  const body = await res.json();
  const instance = res.headers.get("X-Instance-Id");
  const timing = res.headers.get("Server-Timing");
  showDiag(ms, instance, timing, path);
  return { res, body };
}

function showDiag(ms, instance, timing, path) {
  $("diag").textContent =
    `path: ${path}\nclient_ms: ${ms}\ninstance: ${instance}\nserver-timing: ${timing}`;
}

async function loadCategories() {
  const { body } = await api("/api/categories");
  const sel = $("category");
  sel.innerHTML = '<option value="">All</option>';
  for (const c of body) {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c;
    sel.appendChild(o);
  }
}

async function loadProducts() {
  const params = new URLSearchParams({
    limit: state.limit,
    offset: state.offset,
  });
  if (state.category) params.set("category", state.category);
  const { body } = await api("/api/products?" + params.toString());
  state.total = body.total;
  const wrap = $("products");
  wrap.innerHTML = "";
  for (const p of body.items) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `<span>${p.name} (${p.category}) - $${(p.priceCents / 100).toFixed(2)}</span>`;
    const btn = document.createElement("button");
    btn.textContent = "Add";
    btn.onclick = () => addToCart(p);
    div.appendChild(btn);
    wrap.appendChild(div);
  }
  $("pageinfo").textContent =
    `${state.offset + 1}-${Math.min(state.offset + state.limit, state.total)} of ${state.total}`;
}

function addToCart(p) {
  const line = state.cart.find((l) => l.productId === p.id);
  if (line) line.quantity += 1;
  else
    state.cart.push({
      productId: p.id,
      name: p.name,
      priceCents: p.priceCents,
      quantity: 1,
    });
  renderCart();
}

function renderCart() {
  const wrap = $("cart");
  if (state.cart.length === 0) {
    wrap.textContent = "Empty";
    return;
  }
  wrap.innerHTML = "";
  let total = 0;
  for (const l of state.cart) {
    total += l.priceCents * l.quantity;
    const div = document.createElement("div");
    div.className = "cart-line";
    div.innerHTML = `<span>${l.name} x${l.quantity}</span><span>$${((l.priceCents * l.quantity) / 100).toFixed(2)}</span>`;
    wrap.appendChild(div);
  }
  const t = document.createElement("div");
  t.style.fontWeight = "600";
  t.textContent = `Total: $${(total / 100).toFixed(2)}`;
  wrap.appendChild(t);
}

async function checkout() {
  const name = $("name").value.trim();
  const email = $("email").value.trim();
  if (!name || !email || state.cart.length === 0) {
    $("confirm").textContent = "Fill name/email and cart.";
    return;
  }
  const payload = {
    customerName: name,
    customerEmail: email,
    items: state.cart.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
    })),
  };
  const { res, body } = await api("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    $("confirm").textContent =
      `Order #${body.id} confirmed. Total $${(body.totalCents / 100).toFixed(2)}`;
    state.cart = [];
    renderCart();
  } else {
    $("confirm").textContent = `Error: ${body.error && body.error.message}`;
  }
}

async function runReport() {
  await api("/api/report?complexity=3");
}

$("category").addEventListener("change", (e) => {
  state.category = e.target.value;
  state.offset = 0;
  loadProducts();
});
$("prev").addEventListener("click", () => {
  state.offset = Math.max(0, state.offset - state.limit);
  loadProducts();
});
$("next").addEventListener("click", () => {
  if (state.offset + state.limit < state.total) {
    state.offset += state.limit;
    loadProducts();
  }
});
$("checkout").addEventListener("click", checkout);
$("runReport").addEventListener("click", runReport);

loadCategories().then(() => loadProducts());
