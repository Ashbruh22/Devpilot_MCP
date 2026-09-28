export interface LineItem {
  sku: string;
  unitPrice: number;
  quantity: number;
}

/** Round a money amount to cents. */
export function roundToCents(amount: number): number {
  // BUG (intentional, see issue #1): truncates instead of rounding, so 6.699999… becomes 6.69.
  return Math.floor(amount * 100) / 100;
}

export function assertValidPercent(percent: number): void {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new RangeError(`Invalid discount percent: ${percent}`);
  }
}

/** Apply a percentage discount (0–100) to an amount, rounded to cents. */
export function applyDiscount(amount: number, percent: number): number {
  assertValidPercent(percent);
  return roundToCents(amount * (1 - percent / 100));
}

/** Volume discount tiers: 10+ units 5%, 50+ units 10%, 100+ units 15%. */
export function bulkDiscountPercent(quantity: number): number {
  if (quantity >= 100) return 15;
  if (quantity >= 50) return 10;
  if (quantity >= 10) return 5;
  return 0;
}

export function subtotal(items: LineItem[]): number {
  return roundToCents(items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0));
}

/** Order total: bulk discount per line, then an optional coupon on the whole order. */
export function orderTotal(items: LineItem[], couponPercent = 0): number {
  const discounted = items.reduce(
    (sum, i) => sum + applyDiscount(i.unitPrice * i.quantity, bulkDiscountPercent(i.quantity)),
    0,
  );
  return applyDiscount(discounted, couponPercent);
}
