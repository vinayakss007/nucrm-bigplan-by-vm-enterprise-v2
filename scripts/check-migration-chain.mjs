/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Migration-chain consistency guard.
 *
 * `drizzle/migrations/meta/_journal.json` is not a record — it is the manifest.
 * Both runners build their work list by looping over `journal.entries`:
 * `scripts/migrate.ts` (the pending list it prints and the fresh/DR path it
 * feeds) and drizzle's own `readMigrationFiles()`, which backs `migrate()`. So
 * a `.sql` file absent from the journal is invisible to every tool and can
 * never be applied — fresh database or existing one — and nothing says so. That
 * is how 0059 and 0091 went missing, including 0091, the `usage_snapshots`
 * super-admin bypass whose absence makes the weekly usage-snapshot cron die on
 * an RLS violation (its own header documents that failure). A DR database
 * rebuilt today reproduces it silently.
 *
 * The journal is hand-maintained here, which is how a duplicated idx/when pair
 * slipped in: order stops being a total order, and drizzle orders and tiebreaks
 * on exactly those two fields.
 *
 * Checks, against the journal and the directory listing:
 *   missing   up-file with no journal entry  -> can never be applied
 *   orphans   journal entry with no file     -> drizzle throws at migrate()
 *   dupIdx    two entries sharing an idx
 *   dupWhen   two entries sharing a when     -> drizzle's folderMillis tiebreak
 *   order     idx not strictly increasing in journal order
 *
 * Known defects are baselined, like the file-size ratchet, so this can be wired
 * into CI today. Fixing one prints a hint to shrink the baseline.
 *
 * Regenerate after a deliberate repair:
 *   node scripts/check-migration-chain.mjs --update
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const MIGRATIONS_DIR = 'drizzle/migrations';
const JOURNAL = `${MIGRATIONS_DIR}/meta/_journal.json`;
const BASELINE_PATH = 'scripts/migration-chain-baseline.json';
const KINDS = ['missing', 'orphans', 'dupIdx', 'dupWhen', 'order'];

function collect() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .map((f) => f.replace(/\.sql$/, ''))
    .sort();
  const entries = (JSON.parse(readFileSync(JOURNAL, 'utf8')).entries ?? []);
  const tags = entries.map((e) => e.tag);

  const violations = {
    missing: files.filter((t) => !tags.includes(t)).map((t) => `missing:${t}`),
    orphans: tags.filter((t) => !files.includes(t)).map((t) => `orphans:${t}`),
    dupIdx: [],
    dupWhen: [],
    order: [],
  };

  const seenIdx = new Set();
  const seenWhen = new Set();
  entries.forEach((e, pos) => {
    if (seenIdx.has(String(e.idx))) violations.dupIdx.push(`dupIdx:${e.idx}`);
    else seenIdx.add(String(e.idx));
    if (seenWhen.has(String(e.when))) violations.dupWhen.push(`dupWhen:${e.when}`);
    else seenWhen.add(String(e.when));
    if (pos > 0 && Number(e.idx) <= Number(entries[pos - 1]?.idx)) {
      // Keyed on the tag, not the position: positions shift whenever an
      // unrelated entry is added or removed, which would report the same real
      // defect as one healed and one new.
      violations.order.push(`order:${e.tag}`);
    }
  });

  for (const k of KINDS) violations[k] = [...new Set(violations[k])];
  return { counts: { files: files.length, entries: entries.length }, violations };
}

const { counts, violations } = collect();
const flat = KINDS.flatMap((k) => violations[k].map((v) => `${k}|${v}`));

if (process.argv.includes('--update')) {
  const body = {
    _comment: 'Known migration-chain defects. Shrink this file as they are fixed; the guard fails on any NEW one and hints when one disappears. Regenerate: node scripts/check-migration-chain.mjs --update',
    counts,
    violations,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(body, null, 2) + '\n');
  console.log(`[check-migration-chain] baseline written with ${flat.length} known defect(s)`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
} catch {
  console.error(`[check-migration-chain] no baseline at ${BASELINE_PATH} — run: node scripts/check-migration-chain.mjs --update`);
  process.exit(1);
}

const known = new Set(Object.entries(baseline.violations ?? {})
  .flatMap(([k, list]) => (list ?? []).map((v) => `${k}|${v}`)));

const fresh = flat.filter((v) => !known.has(v));
const healed = [...known].filter((v) => !flat.includes(v));

console.log(`[check-migration-chain] ${counts.files} up-file(s) · ${counts.entries} journal entries · ${flat.length} defect(s), ${known.size} baselined`);

if (healed.length > 0) {
  console.log(`  ..   ${healed.length} baselined defect(s) are gone — shrink the baseline:`);
  for (const v of healed) console.log(`       - ${v}`);
  console.log('       node scripts/check-migration-chain.mjs --update');
}

if (fresh.length > 0) {
  console.error(`  ${fresh.length} NEW chain defect(s):`);
  for (const v of fresh) {
    const at = v.indexOf('|');
    console.error(`   x ${v.slice(0, at)}: ${v.slice(at + 1).replace(/^[^:]*:/, '')}`);
  }
  console.error([
    '',
    'Both "npm run db:migrate" and drizzle\'s migrate() loop over journal.entries,',
    'so a migration missing from the journal can never be applied by any tool, and',
    'a duplicate idx/when leaves the chain with no defined order. Repair',
    'drizzle/migrations/meta/_journal.json, or baseline a deliberate exception with',
    '--update and explain it in the PR that does so.',
  ].join('\n'));
  process.exit(1);
}

console.log('[check-migration-chain] OK — no new chain defects.');
