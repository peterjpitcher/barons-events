const currencyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
});

/**
 * Format a number as GBP currency (e.g. "£12.50").
 * Returns "—" for null / undefined / non-finite values.
 */
export function formatCurrency(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "\u2014";
  return currencyFormatter.format(value);
}

/**
 * Format a number as a percentage string (e.g. "12.50%").
 * Returns "—" for null / undefined / NaN.
 *
 * @param decimals — number of decimal places (default 2).
 */
export function formatPercent(value: number | null | undefined, decimals = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "\u2014";
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format an ISO date string for display (e.g. "3 Mar 2026").
 * Returns the raw input if it cannot be parsed.
 */
export function formatDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}
