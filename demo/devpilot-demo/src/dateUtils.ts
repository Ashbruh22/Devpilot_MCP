/** Number of days in a month. `month` is 1-based (1 = January). */
export function daysInMonth(year: number, month: number): number {
  // BUG (intentional, see issue #2): day 0 of month+1 (0-based) is the last day of the
  // month *after* `month`, so February 2024 reports 31 days (March) instead of 29.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Add calendar months, clamping the day (Jan 31 + 1 month = last day of February). */
export function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months; // 0-based, may overflow
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12; // 0-based
  const day = Math.min(date.getUTCDate(), daysInMonth(targetYear, targetMonth + 1));
  return new Date(Date.UTC(targetYear, targetMonth, day));
}

/** Format a date as YYYY-MM-DD (UTC). */
export function formatISODate(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Cannot format an invalid date');
  }
  return date.toISOString().slice(0, 10);
}

/** Due date for an invoice: `termDays` after issue. */
export function dueDate(issued: Date, termDays = 30): Date {
  return new Date(issued.getTime() + termDays * 24 * 60 * 60 * 1000);
}
