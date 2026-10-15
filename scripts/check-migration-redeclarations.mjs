/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2510 root-cause sweep — finds inert `CREATE TABLE IF NOT EXISTS`
 * re-declarations by archaeology-free screen instead.
 *
 * The shape that produced #2509/#2510: 0002_flat_sir_ram.sql creates a table,
 * a later migration "creates" it again with different column types, the later
 * `IF NOT EXISTS` is a no-op on every database that applied 0002, and nothing
 * fails — the drift screen only sees the consequence (column types that
 * disagree with `drizzle/schema`), never the cause. This screen cross-checks
 * every table created by more than one migration against a recorded allowlist
 * of known re-declarations; a NEW one fails the guard with the files and lines
 * named, and entries that no longer re-declare are reported as stale (non-
 * failing, prune them) following the register-drift screen's convention.
 *
 * Usage: node scripts/check-migration-redeclarations.mjs
 * Also asserted from tests/unit/migration-redeclaration-screen-2510.test.ts,
 * so CI runs it on every push even without workflow wiring.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every table the chain creates in more than one file, measured at the
 * revision that wrote this screen. `note` records why the re-declaration is
 * tolerated: most are deliberate backfills for databases that predate a split
 * out of 0002; `super_admin_audit_logs` is the one whose second CREATE carries
 * the never-executed jsonb that #2510 resolved by declaring text in
 * drizzle/schema.
 */
export const KNOWN_REDECLARATIONS = {
  ai_activity: '0016/0017 re-create for databases that skipped the flat 0002 ai block',
  ai_draft_templates: 'same backfill family as ai_activity',
  ai_providers: '0013 vs 0018 — 0018 is the _legacy re-run of 0013 for chain repair',
  approval_requests: '0014 re-declares the 0002 table; no-op wherever 0002 ran',
  at_risk_rules: 'same backfill family as ai_activity',
  comm_email_drafts: 'same backfill family as ai_activity',
  custom_entities: '0071_schema_drift_backfill re-declares 0059; its NOT NULL never executes (the #2509 pair)',
  custom_entity_data: 'same 0059/0071 pair as custom_entities (#2509)',
  documents: '0008 re-declares the 0002 table; no-op wherever 0002 ran',
  follow_ups: '0023 re-declares the 0002 table',
  lead_offers: '0013 vs 0018 legacy re-run family',
  login_attempts: '0006 re-declares the 0002 table',
  login_blocks: '0006 re-declares the 0002 table',
  security_events: '0006 re-declares the 0002 table',
  super_admin_audit_logs: '0007:4 re-declares 0002 with jsonb columns that never executed — #2510; drizzle/schema now says text, the DDL stays text',
  tenant_ai_credentials: '0013 vs 0018 legacy re-run family',
  webhook_field_mappings: '0058 re-declares the 0047 table',
  webhook_queue: '0004_fix_duplicate_tables re-declares the 0002 table',
};

const CREATE_RE = /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(?:"?[a-z_0-9]+"?\.)?"?([a-z_0-9]+)"?/gi;

/** Pure scan over in-memory migration files: { name, sql }.
 * A table is a re-declaration when a LATER file creates it with
 * `IF NOT EXISTS` after an earlier file created it at all — that later
 * statement is parsed, discarded, and its column list never executes, which
 * is the silent shape #2509/#2510 both started from. A bare later CREATE also
 * duplicates the name, but it fails loudly (`relation already exists`), so it
 * is out of this screen's scope. `*.down.sql` recreates dropped tables by
 * design and is excluded. */
export function findRedclarations(files, allowlist = KNOWN_REDECLARATIONS) {
  const byTable = new Map();
  for (const f of files) {
    if (f.name.endsWith('.down.sql')) continue;
    const lines = f.sql.replace(/--[^\n]*/g, '').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(CREATE_RE)) {
        const ifne = Boolean(m[1]);
        const table = m[2];
        if (!byTable.has(table)) byTable.set(table, []);
        byTable.get(table).push({ site: `${f.name}:${i + 1}`, ifne, file: f.name });
      }
    });
  }
  const duplicates = new Map();
  for (const [table, sites] of byTable) {
    const filesWithSites = new Set(sites.map((s) => s.file));
    if (filesWithSites.size < 2) continue;
    const firstFile = sites[0].file;
    const inert = sites.filter((s) => s.ifne && s.file !== firstFile);
    if (inert.length === 0) continue;
    duplicates.set(table, sites);
  }
  const fresh = [...duplicates.entries()].filter(([table]) => !(table in allowlist));
  const stale = Object.keys(allowlist).filter((table) => !duplicates.has(table));
  return { duplicates, fresh, stale, created: byTable.size };
}

export function run(migrationsDir = join(process.cwd(), 'drizzle', 'migrations')) {
  const files = readdirSync(migrationsDir)
    .filter((n) => n.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), 'utf8') }));
  return findRedclarations(files);
}

if (process.argv[1] && process.argv[1].endsWith('check-migration-redeclarations.mjs')) {
  const r = run();
  console.log(`[check-migration-redeclarations] ${r.created} CREATE TABLE sites across ${Object.keys(KNOWN_REDECLARATIONS).length} allowlisted re-declaration(s).`);
  if (r.fresh.length > 0) {
    console.error(`\n✖ ${r.fresh.length} inert CREATE TABLE IF NOT EXISTS re-declaration(s) not on the record (#2510 screen):\n`);
    for (const [table, sites] of r.duplicates) {
      if (table in KNOWN_REDECLARATIONS) continue;
      console.error(`    - ${table}`);
      for (const s of sites) console.error(`        ${s.site}${s.ifne && s.file !== sites[0].file ? '   <- inert IF NOT EXISTS' : ''}`);
    }
    console.error('\n  A second CREATE TABLE IF NOT EXISTS of the same table is a no-op on every');
  console.error('  database where the first ran: its column list never executes (#2509/#2510 both');
  console.error('  started exactly there). ALTER the columns explicitly, or fold the table into the');
  console.error('  first migration — never re-declare. If the re-declaration is deliberate legacy');
  console.error('  backfill, add the table to KNOWN_REDECLARATIONS with a written note.');
    process.exit(1);
  }
  for (const table of r.stale) {
    console.log(`NOTE (non-failing): allowlisted re-declaration no longer duplicates — prune it: ${table}`);
  }
  console.log('[check-migration-redeclarations] OK.');
}
