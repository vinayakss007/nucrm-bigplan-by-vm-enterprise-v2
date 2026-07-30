/**
 * Shared helper functions for seed modules.
 */

export const log = (emoji: string, msg: string) => console.log(`${emoji}  ${msg}`);
export const logSection = (msg: string) => console.log(`\n\x1b[36m━━━ ${msg} ━━━\x1b[0m`);
export const logDone = (table: string, count: number) =>
  console.log(`  \x1b[32m✓\x1b[0m ${table} (${count} rows)`);

export function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function futureDate(daysAhead: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d;
}

export function pastDate(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}
