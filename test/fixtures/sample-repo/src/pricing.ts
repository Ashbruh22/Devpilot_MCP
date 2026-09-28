export function assertValidPercent(percent: number): void {
  if (percent < 0 || percent > 100) {
    throw new RangeError(`Invalid discount percent: ${percent}`);
  }
}

/** Apply a percentage discount and round to cents. */
export function applyDiscount(amount: number, percent: number): number {
  assertValidPercent(percent);
  const discounted = amount * (1 - percent / 100);
  return Math.floor(discounted * 100) / 100; // BUG: floors instead of rounding
}
