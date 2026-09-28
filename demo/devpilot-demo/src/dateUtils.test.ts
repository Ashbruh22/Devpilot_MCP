import { describe, expect, it } from 'vitest';
import { addMonths, dueDate, formatISODate, isLeapYear } from './dateUtils';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('dates', () => {
  it('knows leap years', () => {
    expect([2023, 2024, 1900, 2000].map(isLeapYear)).toEqual([false, true, false, true]);
  });

  it('adds months within a year', () => {
    expect(formatISODate(addMonths(d('2024-03-15'), 2))).toBe('2024-05-15');
  });

  it('clamps to the end of February in a leap year', () => {
    expect(formatISODate(addMonths(d('2024-01-31'), 1))).toBe('2024-02-29');
  });

  it('computes invoice due dates', () => {
    expect(formatISODate(dueDate(d('2024-01-01')))).toBe('2024-01-31');
  });
});
