/**
 * Which migration files issue index DDL that locks writes out (#3301).
 *
 * A plain `CREATE INDEX` takes SHARE on its table for the duration of the
 * build, and drizzle-orm's `migrate()` puts one transaction around every pending
 * file — so the lock is held across the whole backlog apply, not just one build.
 * `scripts/migrate-fresh.ts` answers the same question for the runner with
 * `extractStatements()` + `partitionStatements()`; this module answers it for
 * plain-`node` guards, which have no TS loader to import the runner with.
 *
 * `tests/unit/migration-blocking-index-3301.test.ts` pins the two verdicts
 * against each other on the real files, so they cannot drift apart.
 */

/** Statement text a file would issue, with comments and dollar-quoted bodies
 *  removed — a CREATE INDEX planned inside `EXECUTE '…'` is not a top-level
 *  statement and is not what the runner routes outside a transaction. */
export function topLevelIndexDdl(text) {
  const bare = text
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\$([^$]*)\$[\s\S]*?\$\1\$/g, ' ');
  return bare
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(line));
}

/** True when the file issues at least one write-locking (non-CONCURRENTLY)
 *  index build. */
export function hasBlockingIndexBuild(text) {
  return topLevelIndexDdl(text).some((line) => !/\bCONCURRENTLY\b/i.test(line));
}
