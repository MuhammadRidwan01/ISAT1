export function calculateTotal(items) {
  return items.reduce((sum, it) => sum + it.unitPriceCents * it.quantity, 0);
}
