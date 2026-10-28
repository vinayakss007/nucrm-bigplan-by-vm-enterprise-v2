/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3280 — which tables can silently answer `count(*) = 0`.
 *
 * `DATABASE_URL` connects as `nucrm_app`, which is not the table owner
 * (`docs/database-security.md`: point the app at `nucrm_app`, never the owner), is
 * not a superuser and has no `BYPASSRLS`. A role in that position is subject to
 * Row Level Security on **every** table where it is enabled — `FORCE` is only what
 * binds the owner, and migration 0068_force_rls_owner.sql applies `FORCE` in a
 * loop the parser below cannot enumerate anyway. Measured on the live schema: 226
 * tables, 226 with `relrowsecurity`, 225 with `relforcerowsecurity`, 0 owned by
 * `nucrm_app`.
 *
 * So the set is: every table the schema declares, minus the ones a `USING (true)`
 * SELECT policy makes readable from any session. That difference is what an
 * unarmed read cannot recover — 19 of the 226 are open and read honestly; the
 * other 207 answer 0 without raising (`users` 0 against 28, `contacts` 0 against
 * 66, `deal_stages` 0 against 146, all measured on a development database).
 *
 * Read from the journal in migration order, because 0088 dropped two of the
 * `read_all` policies 0054 had created; a policy that no longer exists must not
 * exempt its table. Forward `.sql` only — a `.down.sql` does not change the live
 * schema.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DECLARED = /pgTable[\w<>{}]*\(\s*['"]([a-z_][a-z0-9_]*)['"]/g;
const OPEN_SELECT = /CREATE\s+POLICY\s+["']?([a-z_0-9]+)["']?\s+ON\s+["']?([a-z_][a-z0-9_]*)["']?\s+FOR\s+SELECT\s+USING\s*\(\s*true\s*\)/gi;
const DROPPED = /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?["']?([a-z_0-9]+)["']?\s+ON\s+["']?([a-z_][a-z0-9_]*)["']?/gi;

function forwardFiles(dir) {
  if (!existsSync(dir)) throw new Error(`no such directory: ${dir}`);
  return readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql')).sort();
}

/** Tables whose `FOR SELECT USING (true)` policy is still standing at the end of the journal. */
export function readOpenTables(migrationsDir = join(process.cwd(), 'drizzle/migrations')) {
  const standing = new Map();
  for (const file of forwardFiles(migrationsDir)) {
    const text = readFileSync(join(migrationsDir, file), 'utf8');
    for (const m of text.matchAll(OPEN_SELECT)) {
      if (!standing.has(m[2])) standing.set(m[2], new Set());
      standing.get(m[2]).add(m[1]);
    }
    for (const m of text.matchAll(DROPPED)) {
      const policies = standing.get(m[2]);
      if (!policies) continue;
      policies.delete(m[1]);
      if (policies.size === 0) standing.delete(m[2]);
    }
  }
  return [...standing.keys()].sort();
}

/** Every table the Drizzle schema declares, public schema assumed. */
export function declaredTables(schemaDir = join(process.cwd(), 'drizzle/schema')) {
  const names = new Set();
  if (!existsSync(schemaDir)) throw new Error(`no such directory: ${schemaDir}`);
  for (const file of readdirSync(schemaDir).filter((f) => /\.ts$/.test(f)).sort()) {
    const text = readFileSync(join(schemaDir, file), 'utf8');
    for (const m of text.matchAll(DECLARED)) names.add(m[1]);
  }
  return [...names].sort();
}

/**
 * Tables whose rows an RLS-subject, non-owner role may not see without declaring a
 * context: declared, and no standing open SELECT policy.
 */
export function rlsFilteredTables({
  schemaDir = join(process.cwd(), 'drizzle/schema'),
  migrationsDir = join(process.cwd(), 'drizzle/migrations'),
} = {}) {
  const open = new Set(readOpenTables(migrationsDir));
  return declaredTables(schemaDir).filter((t) => !open.has(t));
}
