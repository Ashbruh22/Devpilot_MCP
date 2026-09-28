import { describe, expect, it } from 'vitest';
import { applyDiscount, bulkDiscountPercent, orderTotal, subtotal } from './pricing';

describe('applyDiscount', () => {
  it('applies a simple percentage', () => {
    expect(applyDiscount(200, 25)).toBe(150);
  });

  it('rejects invalid percentages', () => {
    expect(() => applyDiscount(10, 120)).toThrow(RangeError);
  });

  it('rounds to the nearest cent', () => {
    // 10 * 0.67 = 6.699999999999999 in floating point; the correct price is 6.70.
    expect(applyDiscount(10, 33)).toBe(6.7);
  });
});

describe('bulk pricing', () => {
  it('picks the right tier', () => {
    expect([1, 10, 50, 100].map(bulkDiscountPercent)).toEqual([0, 5, 10, 15]);
  });

  it('computes subtotals', () => {
    expect(subtotal([{ sku: 'a', unitPrice: 2.5, quantity: 4 }])).toBe(10);
  });

  it('combines bulk and coupon discounts', () => {
    expect(orderTotal([{ sku: 'a', unitPrice: 10, quantity: 10 }], 10)).toBe(85.5);
  });
});
