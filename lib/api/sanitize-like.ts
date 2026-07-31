/**
 * Escapes LIKE/ILIKE pattern metacharacters (% and _) in user-supplied search input.
 *
 * Drizzle ORM parameterizes the value so there is no SQL injection risk, but
 * unescaped wildcards let a user craft queries that match unintended rows
 * (e.g. `q=_%` matches every non-empty value). This utility neutralizes those
 * characters so they are treated as literal text.
 */
export function escapeLike(value: string): string {
  return value.replace(/%/g, '\\%').replace(/_/g, '\\_');
}
