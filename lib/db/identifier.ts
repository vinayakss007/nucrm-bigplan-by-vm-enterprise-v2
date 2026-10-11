/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Escaping for SQL identifiers that reach a statement as text.
 *
 * A table or column name can never be a bound parameter, so the dynamic builders
 * (`lib/db/client.ts`, `lib/data-integrity.ts`, the SQL exporter) splice theirs
 * straight into the query. Wrapping the name in double quotes is NOT escaping:
 * the key `is_super_admin" = true, "email` closes its own quote and reopens the
 * statement, which is how #2528 turned an ordinary PATCH body into a super-admin
 * grant while the caller read back a normal-looking row.
 *
 * PostgreSQL escaping is doubling every `"` inside the quoted form — the same
 * rule drizzle's `sql.identifier()` implements. This is that rule for the raw
 * `pg` paths that cannot use drizzle. Escaping rather than rejecting keeps
 * legitimate quoted names working (`"MixedCase"` must stay updatable).
 *
 * Table names still go through the allowlist first (`lib/sql-allowlist.ts`, or
 * the narrower client.ts set); this is the layer that makes the *column* names
 * safe, and the last line of defence for anything that skips an allowlist.
 */

/**
 * Render `name` as a quoted PostgreSQL identifier.
 *
 * @throws if the name is not a non-empty string, or contains a NUL byte —
 * neither can be represented as an identifier at all.
 */
export function quoteIdentifier(name: string): string {
  if (typeof name !== 'string' || name.length === 0 || name.includes('\u0000')) {
    const shown = typeof name === 'string' ? JSON.stringify(name.slice(0, 64)) : String(name);
    throw new Error(`quoteIdentifier: identifier must be a non-empty string without NUL bytes (got ${shown})`);
  }
  return `"${name.replace(/"/g, '""')}"`;
}
