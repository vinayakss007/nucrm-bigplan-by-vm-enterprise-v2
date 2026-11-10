/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying, distribution or use is prohibited.
 */

/**
 * #3406 — the screen that keeps a deleted row from keeping its key reserved.
 *
 * `scripts/check-partial-unique-indexes.mts` re-derives every unique surface on a
 * soft-deletable table from the migration corpus and demands each one is either
 * partial on `deleted_at` or declared absolute with a reason. It is the thing that
 * makes this fix durable, which means the screen's own parsing is the part that has
 * to be tested — a guard that silently reads nothing looks exactly like a guard that
 * reads everything and finds it clean.
 *
 * Two such silences were found while writing this file, both of them mine, both of
 * them caught by asserting a number rather than a verdict:
 *
 *   - the corpus regexes read an optional `schema.` prefix as `"?[\w.]*\.)?`, which
 *     cannot cross the closing quote of `"public"`, so every `"public"."teams"` DDL
 *     line filed its surface under a table named `public` and vanished from the
 *     census — 151 index statements, including one that had already dropped a
 *     surface this migration was about to "restore";
 *   - the upsert scanner matched brackets by counting parentheses, and a `(` in a
 *     prose comment (this repo writes plenty) truncated the options object before
 *     `targetWhere` was reached, which is a false accusation on a correct route.
 *
 * So: fixtures for both, and a totals assertion for the live repo, because the totals
 * are the tripwire that a parser stopped parsing.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { analyze, blankComments, readConflictSites, readCorpus } from '../../scripts/check-partial-unique-indexes.mts';

const ROOT = join(import.meta.dirname!, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-partial-unique-indexes.mts');

const dir = mkdtempSync(join(tmpdir(), 'partial-unique-3406-'));
let n = 0;

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function fixture(files: Record<string, string>): string {
  const sub = join(dir, `case-${n++}`);
  for (const [rel, text] of Object.entries(files)) {
    const full = join(sub, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return sub;
}

function run(root: string, ...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', SCRIPT, ...args, root], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

/** Corpus + schema for a soft-deletable table whose unique index is written `how`. */
function caseFiles(indexDdl: string, schemaDecl: string, route = ''): Record<string, string> {
  const files: Record<string, string> = {
    'drizzle/migrations/0001_shape.sql': [
      'CREATE TABLE "widgets" (',
      '  "id" text PRIMARY KEY,',
      '  "name" text,',
      '  "tenant_id" text,',
      '  "deleted_at" timestamp with time zone',
      ');',
      indexDdl,
    ].join('\n'),
    'drizzle/schema/widgets.ts': [
      "import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';",
      "import { sql } from 'drizzle-orm';",
      "export const widgets = pgTable('widgets', {",
      "  id: text('id'),",
      "  name: text('name'),",
      "  tenantId: text('tenant_id'),",
      "  deletedAt: timestamp('deleted_at', { withTimezone: true }),",
      '}, (table) => ({',
      `  ${schemaDecl}`,
      '}));',
    ].join('\n'),
  };
  if (route) files['app/api/widgets/route.ts'] = route;
  return files;
}

const PARTIAL_SCHEMA = "nameLive: uniqueIndex('widgets_name_unique_live').on(table.name).where(sql`${table.deletedAt} IS NULL`),";
const ABSOLUTE_SCHEMA = "name: uniqueIndex('widgets_name_unique').on(table.name),";

describe('#3406 the screen reads what the corpus says', () => {
  it('reports a tombstone-blind unique index on a soft-deletable table', () => {
    const root = fixture(caseFiles(
      'CREATE UNIQUE INDEX "widgets_name_unique" ON "widgets" ("name");',
      ABSOLUTE_SCHEMA,
    ));
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('MISSING  widgets [index] widgets_name_unique');
  });

  it('accepts the same surface once it excludes tombstones', () => {
    const root = fixture(caseFiles(
      'CREATE UNIQUE INDEX "widgets_name_unique_live" ON "widgets" ("name") WHERE deleted_at IS NULL;',
      PARTIAL_SCHEMA,
    ));
    const r = run(root);
    expect(r.stdout).toContain('0 unexplained');
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it('a schema that declares the index as a plain index() is UNBOUND — the next generate undoes it', () => {
    const root = fixture(caseFiles(
      'CREATE UNIQUE INDEX "widgets_name_unique_live" ON "widgets" ("name") WHERE deleted_at IS NULL;',
      "nameLive: uniqueIndex('widgets_name_unique_live').on(table.name),",
    ));
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/UNBOUND\s+widgets widgets_name_unique_live/);
  });

  it('reads `"public"."table"` qualification as the same surface, not as a table called public', () => {
    // The regression that made 151 corpus statements invisible to this screen.
    const root = fixture(caseFiles(
      'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "widgets_name_unique_live" ON "public"."widgets" ("name") WHERE deleted_at IS NULL;',
      PARTIAL_SCHEMA,
    ));
    const { surfaces, softTables } = readCorpus(root);
    expect(softTables.has('widgets')).toBe(true);
    expect([...surfaces.values()].some((s) => s.table === 'public')).toBe(false);
    const live = surfaces.get('widgets#widgets_name_unique_live');
    expect(live?.where).toBe('deleted_at IS NULL');
    expect(run(root).status).toBe(0);
  });

  it('honours a DROP: a surface removed by a later file is not counted', () => {
    const root = fixture({
      'drizzle/migrations/0001_shape.sql': caseFiles(
        'CREATE UNIQUE INDEX "widgets_name_unique" ON "widgets" ("name");',
        ABSOLUTE_SCHEMA,
      )['drizzle/migrations/0001_shape.sql'],
      'drizzle/migrations/0002_gone.sql': 'DROP INDEX IF EXISTS "public"."widgets_name_unique";',
    });
    const r = run(root);
    expect(r.stdout, r.stdout).toContain('0 unique surfaces on them');
    expect(r.status).toBe(0);
  });
});

describe('#3406 the screen reads what the call sites say', () => {
  const upsert = (extra: string) => [
    "import { sql } from 'drizzle-orm';",
    "import { db } from '@/lib/db';",
    "import { widgets } from '../../../drizzle/schema/widgets';",
    'export async function POST(req: Request) {',
    '  await db.insert(widgets).values({ id: req.headers.get("x"), name: "n", tenantId: "t" })',
    '    .onConflictDoUpdate({',
    '      target: [widgets.name],',
    extra,
    '      set: { name: sql`excluded.name` },',
    '    });',
    '  return new Response(null);',
    '}',
  ].join('\n');

  it('an upsert onto a partial surface without targetWhere cannot infer it (42P10)', () => {
    const root = fixture(caseFiles(
      'CREATE UNIQUE INDEX "widgets_name_unique_live" ON "public"."widgets" ("name") WHERE deleted_at IS NULL;',
      PARTIAL_SCHEMA,
      upsert('      // #2740: Postgres cannot infer a partial index from columns alone,'),
    ));
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/UNTARGETED\s+app\/api\/widgets\/route\.ts:\d+ — onConflictDoUpdate\/Nothing on widgets\(name\)/);
  });

  it('the same upsert with targetWhere is clean', () => {
    const root = fixture(caseFiles(
      'CREATE UNIQUE INDEX "widgets_name_unique_live" ON "public"."widgets" ("name") WHERE deleted_at IS NULL;',
      PARTIAL_SCHEMA,
      upsert('      targetWhere: sql`${widgets.deletedAt} IS NULL`,'),
    ));
    const r = run(root);
    expect(r.stdout, r.stdout + r.stderr).toContain('0 missing their predicate');
    expect(r.status).toBe(0);
  });

  it('raw SQL is read too: ON CONFLICT (cols) DO UPDATE needs the predicate in the clause', () => {
    // This is the half CI caught and the builder scan could not see.
    const root = fixture(caseFiles(
      'CREATE UNIQUE INDEX "widgets_name_unique_live" ON "public"."widgets" ("name") WHERE deleted_at IS NULL;',
      PARTIAL_SCHEMA,
      [
        "import { sql } from 'drizzle-orm';",
        'export async function POST(client: { query: (s: string, p: unknown[]) => Promise<unknown> }) {',
        '  await client.query(`',
        '    INSERT INTO widgets (id, name, tenant_id) VALUES ($1, $2, $3)',
        '    ON CONFLICT (name) DO UPDATE SET name = excluded.name',
        '  `, ["1", "n", "t"]);',
        '  return new Response(null);',
        '}',
      ].join('\n'),
    ));
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/UNTARGETED\s+app\/api\/widgets\/route\.ts:\d+ — raw ON CONFLICT on widgets\(name\)/);
  });

  it('raw SQL that does restate the predicate is clean', () => {
    const root = fixture(caseFiles(
      'CREATE UNIQUE INDEX "widgets_name_unique_live" ON "public"."widgets" ("name") WHERE deleted_at IS NULL;',
      PARTIAL_SCHEMA,
      [
        'export async function POST(client: { query: (s: string, p: unknown[]) => Promise<unknown> }) {',
        '  await client.query(`',
        '    INSERT INTO widgets (id, name, tenant_id) VALUES ($1, $2, $3)',
        '    ON CONFLICT (name) WHERE deleted_at IS NULL DO UPDATE SET name = excluded.name',
        '  `, ["1", "n", "t"]);',
        '  return new Response(null);',
        '}',
      ].join('\n'),
    ));
    expect(run(root).status).toBe(0);
  });

  it('a deliberate negative control declares itself, and the screen stays quiet', () => {
    // #2740's reproducer asserts the 42P10; a guard that demanded a fix there would
    // be asking for the test to stop testing the thing it exists to test.
    const root = fixture(caseFiles(
      'CREATE UNIQUE INDEX "widgets_name_unique_live" ON "public"."widgets" ("name") WHERE deleted_at IS NULL;',
      PARTIAL_SCHEMA,
      [
        'export async function POST(client: { query: (s: string, p: unknown[]) => Promise<unknown> }) {',
        '  // partial-unique:allow 42P10 — negative control, the omission is the assertion',
        '  await client.query(`',
        '    INSERT INTO widgets (id, name, tenant_id) VALUES ($1, $2, $3)',
        '    ON CONFLICT (name) DO UPDATE SET name = excluded.name',
        '  `, ["1", "n", "t"]);',
        '  return new Response(null);',
        '}',
      ].join('\n'),
    ));
    expect(run(root).stdout, run(root).stdout).toContain('0 missing their predicate');
    expect(run(root).status).toBe(0);
  });

  it('a parenthesis in a comment does not truncate the options object', () => {
    // The scan used to count parens; this comment used to hide a real targetWhere.
    const root = fixture(caseFiles(
      'CREATE UNIQUE INDEX "widgets_name_unique_live" ON "public"."widgets" ("name") WHERE deleted_at IS NULL;',
      PARTIAL_SCHEMA,
      upsert([
        '      // rejected with 42P10 (before it runs), exactly how this route 500s today',
        '      targetWhere: sql`${widgets.deletedAt} IS NULL`,',
      ].join('\n')),
    ));
    const site = readConflictSites(root).find((s) => s.table === 'widgets');
    expect(site, 'the fixture site was not even found').toBeDefined();
    expect(site!.hasTargetWhere).toBe(true);
    expect(run(root).status).toBe(0);
  });

  it('blankComments preserves every offset, so a line number survives the blanking', () => {
    const src = 'const a = 1; // paren ( trap (\nconst b = { c: "d" } /* block ( */);\n';
    const blanked = blankComments(src);
    expect(blanked.length).toBe(src.length);
    expect(blanked.split('\n').length).toBe(src.split('\n').length);
    expect(blanked).not.toContain('trap');
    expect(blanked.indexOf('const b')).toBe(src.indexOf('const b'));
  });

  it('every ON CONFLICT site in the repo is attributed to a table it can name', () => {
    const sites = readConflictSites(ROOT);
    expect(sites.length).toBeGreaterThan(40);
    const unknown = sites.filter((s) => !s.table);
    // An unresolved insert is a blind spot, not a failure — but a growing one means
    // the pass is reading fewer sites every month. 4 is the measured ceiling today.
    expect(unknown.length, unknown.map((s) => `${s.file}:${s.line}`).join(', ')).toBeLessThanOrEqual(4);
  });
});

describe('#3406 the live repo reads clean, and the census is the published one', () => {
  const report = analyze(ROOT);

  it('has no finding of any class', () => {
    expect(report.findings).toEqual([]);
    expect(report.schemaFindings).toEqual([]);
    expect(report.staleExemptions).toEqual([]);
    expect(report.upsertFindings).toEqual([]);
  });

  it('reports the numbers the migration header and the docs quote', () => {
    // Pinning the census is the point: each of these moved once already this PR,
    // when a parser stopped seeing statements it had been counting.
    expect(report.totals).toEqual({
      migrations: 147,
      softTables: 204,
      uniqueOnSoft: 59,
      partial: 34,
      absolute: 25,
      conflictSites: expect.any(Number),
    });
  });

  it('--json is machine-readable and carries the same totals', () => {
    const r = run(ROOT, '--json');
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.totals.partial).toBe(34);
    expect(parsed.findings).toEqual([]);
  });
});
