export function parsePrice(input: string): number {
  return Number(input.replace(/[$,]/g, ''));
}

export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Cannot format non-finite price: ${value}`);
  }
  return `$${value.toFixed(2)}`;
}
