import { describe, expect, it } from 'vitest';
import { applyDiscount } from './pricing';

describe('applyDiscount', () => {
  it('applies a simple discount', () => {
    expect(applyDiscount(100, 10)).toBe(90);
  });

  it('rounds 33% off 10 to cents', () => {
    expect(applyDiscount(10, 33)).toBe(6.7);
  });

  it('rounds 33% off 20 to cents', () => {
    expect(applyDiscount(20, 33)).toBe(13.4);
  });

  it.skip('supports tiered discounts', () => {});
});
