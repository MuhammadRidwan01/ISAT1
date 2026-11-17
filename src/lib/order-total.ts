export interface OrderLine {
  unitPriceCents: number;
  quantity: number;
}

export function calculateTotal(items: OrderLine[]): number {
  return items.reduce((sum, it) => sum + it.unitPriceCents * it.quantity, 0);
}