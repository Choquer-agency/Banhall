// AI provider pricing is billed in USD; the business reports in CAD.
// Costs stay USD in the database (source of truth matches the invoice) and
// convert at display time so the rate can change without a data migration.
// Update this rate when the finance team's planning rate changes.
export const USD_TO_CAD = 1.37;

/** Convert a USD amount and format it as CAD. */
export function cad(usd: number): string {
  const value = usd * USD_TO_CAD;
  return value.toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  });
}

/** Compact CAD for chart labels ("$1.2k", "$45", "$0.03"). */
export function cadCompact(usd: number): string {
  const value = usd * USD_TO_CAD;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  if (value >= 100) return `$${Math.round(value)}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(value >= 0.01 ? 2 : 4)}`;
}
