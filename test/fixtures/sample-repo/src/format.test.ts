import { expect, it } from 'vitest';
import { formatPrice, parsePrice } from './format';

it('formats prices with two decimals', () => {
  expect(formatPrice(1.5)).toBe('$1.50');
});

it('formats a parsed price with a currency symbol', () => {
  expect(formatPrice(parsePrice('USD 12'))).toBe('$12.00');
});
