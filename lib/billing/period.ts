/**
 * Shared billing period utilities.
 *
 * All billing-period-related logic lives here so consumers
 * don't define their own copies.
 */

/**
 * Get the current billing period string in 'YYYY-MM' format.
 */
export function getCurrentBillingPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
