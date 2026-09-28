// Token-budget-aware truncation helpers. Every tool response passes through these,
// so no tool can return unbounded output.

export function truncationMarker(removed: number): string {
  return `…[truncated ${removed.toLocaleString('en-US')} chars]`;
}

/** Keep the head of `text`, appending a marker if anything was cut. */
export function truncateText(text: string, maxChars: number): string {
  if (maxChars < 0) maxChars = 0;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + truncationMarker(text.length - maxChars);
}

/** Keep the tail of `text` (useful for test output, where the summary is at the end). */
export function truncateTail(text: string, maxChars: number): string {
  if (maxChars < 0) maxChars = 0;
  if (text.length <= maxChars) return text;
  return truncationMarker(text.length - maxChars) + text.slice(text.length - maxChars);
}

/** Truncate a single line for previews. */
export function truncateLine(line: string, maxChars = 300): string {
  return truncateText(line.replace(/\r$/, ''), maxChars);
}

/** Take at most `max` items, reporting whether anything was dropped. */
export function capList<T>(items: readonly T[], max: number): { items: T[]; truncated: boolean } {
  return { items: items.slice(0, Math.max(0, max)), truncated: items.length > max };
}

/**
 * Split a character budget across several strings in order: each string gets what it needs
 * until the budget runs out; later strings are truncated (possibly to empty + marker).
 */
export function fitToBudget(texts: string[], budget: number): string[] {
  let remaining = budget;
  return texts.map((t) => {
    const out = truncateText(t, Math.max(0, remaining));
    remaining -= Math.min(t.length, Math.max(0, remaining));
    return out;
  });
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}
