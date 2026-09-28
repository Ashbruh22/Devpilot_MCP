import { describe, expect, it } from 'vitest';
import { capList, fitToBudget, stripAnsi, truncateTail, truncateText } from '../src/lib/truncate.js';

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncateText('hello', 10)).toBe('hello');
  });

  it('cuts to the limit and adds a marker with the removed count', () => {
    const out = truncateText('a'.repeat(5_000), 100);
    expect(out.startsWith('a'.repeat(100))).toBe(true);
    expect(out).toContain('…[truncated 4,900 chars]');
  });

  it('keeps the tail when asked', () => {
    const out = truncateTail('x'.repeat(50) + 'END', 3);
    expect(out).toBe('…[truncated 50 chars]END');
  });

  it('splits a budget across strings in order', () => {
    const [a, b, c] = fitToBudget(['aaaa', 'bbbb', 'cccc'], 6);
    expect(a).toBe('aaaa');
    expect(b).toBe('bb…[truncated 2 chars]');
    expect(c).toBe('…[truncated 4 chars]');
  });

  it('caps lists', () => {
    expect(capList([1, 2, 3], 2)).toEqual({ items: [1, 2], truncated: true });
    expect(capList([1], 2)).toEqual({ items: [1], truncated: false });
  });

  it('strips ANSI color codes', () => {
    expect(stripAnsi('\u001b[31mred\u001b[39m')).toBe('red');
  });
});
