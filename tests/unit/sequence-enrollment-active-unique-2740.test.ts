/**
 * #2740 — static half of the proof.
 *
 * `tests/integration/sequence-enrollment-active-unique-2740.test.ts` shows a real Postgres
 * accepting one live drip per (sequence, contact). It needs a database, so it self-skips on a
 * machine without one, and CI runs it only on the jobs that provision Postgres. This file is the
 * half that always runs: it pins the four places the predicate is written down, the order the
 * migration does its two jobs in, and the per-tenant RLS loop that the CI superuser cannot
 * otherwise be made to respect (PP-058).
 *
 * Each assertion is a regression a reviewer could introduce with a one-line edit:
 *   * drop `targetWhere` from the route and the upsert is 42P10 again (a partial index cannot be
 *     inferred from the conflict columns alone) — and no unit mock would notice;
 *   * change the predicate in any one of the four places and either the sweep double-sends again
 *     or a re-enroll after completion starts failing;
 *   * move `CREATE UNIQUE INDEX` above the dedupe and the migration aborts on the rows the dedupe
 *     was written to clean up;
 *   * take the `set_config('app.current_tenant', …)` loop out and the dedupe silently updates zero
 *     rows on a FORCE-RLS production database.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '..', '..');
const MIGRATIONS = join(ROOT, 'drizzle', 'migrations');
const TAG = '0130_sequence_enrollments_active_unique';
const INDEX = 'sequence_enrollments_seq_contact_active_unique';

/** A branch without the fix must fail each named assertion, not blow up at module load — one
 *  thrown `readFileSync` reports a single suite-level error and hides which of the twenty-three
 *  guarantees is missing. Existence itself is asserted below, with a message that says so. */
function readOrEmpty(rel: string): string {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

const up = readOrEmpty(`drizzle/migrations/${TAG}.sql`);
const down = readOrEmpty(`drizzle/migrations/${TAG}.down.sql`);
const schemaSrc = readOrEmpty('drizzle/schema/marketing.ts');
const enrollRoute = readOrEmpty('app/api/tenant/contacts/[id]/enroll/route.ts');
const journal = JSON.parse(
  readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8'),
) as { entries: { idx: number; tag: string }[] };

const BREAKPOINT = '--> statement-breakpoint';

/** SQL only: the `/*!` banner and every `--` line are prose, and prose cannot make a migration do
 *  anything. `0114`'s header describes an UPDATE it does not contain — so does this one. */
function stripProse(chunk: string): string {
  return chunk
    .replace(/\/\*![\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
}

/** Split the way `scripts/migrate.ts` does, then drop the prose from each statement. */
function statementsOf(src: string): string[] {
  return src.split(BREAKPOINT).map(stripProse).map((s) => s.trim()).filter((s) => s.length > 0);
}

const upSql = statementsOf(up).join('\n');
const statements = statementsOf(up);

describe('#2740 migration 0130 is journaled and replayable', () => {
  it('is journaled once, at its own idx, with both files on disk', () => {
    const entry = journal.entries.find((e) => e.tag === TAG);
    expect(entry, `${TAG} is not in meta/_journal.json, so no deploy would ever run it`).toBeDefined();
    expect(entry!.idx, 'journal idx must match the file prefix').toBe(130);
    // This line used to read `journal.entries.at(-1).tag === TAG`, which pins the head
    // of the journal — a property of the branch it was written on, not of 0130. The
    // next migration merged after it fails it, and #2880's 0131 did exactly that. What
    // this file can keep forever is that the tag is journaled once: a tag appearing
    // twice is applied once by `scripts/migrate.ts` and counted twice by every reader.
    expect(
      journal.entries.filter((e) => e.tag === TAG),
      `${TAG} is journaled more than once`,
    ).toHaveLength(1);
    expect(existsSync(join(MIGRATIONS, `${TAG}.sql`))).toBe(true);
    expect(existsSync(join(MIGRATIONS, `${TAG}.down.sql`))).toBe(true);
  });

  it('splits into exactly two statements, each carrying its own semicolon', () => {
    // `scripts/migrate.ts` does not re-append terminators after splitting on the breakpoint, so a
    // statement without one is a syntax error at deploy time.
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(statement.trim().endsWith(';'), `statement is unterminated: ${statement.slice(0, 40)}`).toBe(true);
    }
  });

  it('dedupes before it constrains', () => {
    const dedupe = statements[0]!;
    const create = statements[1]!;
    expect(dedupe).toMatch(/^DO \$\$/);
    expect(create).toMatch(/^CREATE UNIQUE INDEX/);
    // Reversing the two is the PP-058 trap: `CREATE UNIQUE INDEX` reads the whole heap whatever
    // the policy says, so it aborts on exactly the duplicates the UPDATE was there to remove.
    expect(upSql.indexOf('row_number')).toBeLessThan(upSql.indexOf('CREATE UNIQUE INDEX'));
  });

  it('is idempotent, because every deploy re-checks the chain', () => {
    expect(upSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
    expect(upSql).not.toMatch(/ADD CONSTRAINT/);
  });

  it('the down migration drops the index and refuses to resurrect the duplicates', () => {
    expect(statementsOf(down)).toEqual([`DROP INDEX IF EXISTS "${INDEX}";`]);
    // A down file that set the cancelled rows back to 'active' would restore the double-send this
    // issue is about, on a rollback, with nothing in the app able to re-activate them.
    expect(stripProse(down)).not.toMatch(/UPDATE|INSERT|DELETE/);
  });
});

describe('#2740 the dedupe keeps one row per pair and destroys nothing', () => {
  it('keeps the newest enrolled_at and cancels the rest', () => {
    expect(upSql).toContain('PARTITION BY "sequence_id", "contact_id"');
    expect(upSql).toContain('ORDER BY "enrolled_at" DESC');
    expect(upSql).toContain('WHERE dup.rn > 1');
    expect(upSql).toMatch(/SET "status" = 'cancelled'/);
    // COALESCE: the app's own cancel helper only stamps completed_at when there is not one yet.
    expect(upSql).toMatch(/"completed_at" = COALESCE\(e\."completed_at", NOW\(\)\)/);
    expect(upSql).toMatch(/"updated_at" = NOW\(\)/);
  });

  it('cancels rows, never deletes them', () => {
    // Every `sequence_step_logs` row already points at its enrollment; a DELETE would orphan the
    // send history the tenant is going to ask about.
    expect(upSql).not.toMatch(/DELETE FROM/);
  });

  it('takes the duplicate out of the send queue too', () => {
    // A cancelled enrollment with a 'pending' step log is a scheduled send with nothing left to
    // send it — mirrors lib/cron/sequence-steps.ts cancelOpenEnrollments.
    expect(upSql).toMatch(/UPDATE "sequence_step_logs"/);
    expect(upSql).toMatch(/g\."enrollment_id" = c\."id"/);
    expect(upSql).toMatch(/g\."status" = 'pending'/);
  });

  it('leaves sequences.enroll_count alone, like every cancel path in the app', () => {
    expect(upSql).not.toMatch(/enroll_count/);
  });

  it('scopes the duplicate groups to one tenant', () => {
    // Without this the keeper could be another tenant's row, and the dedupe would cancel across
    // the isolation boundary it is not allowed to read.
    expect(upSql).toContain('WHERE "tenant_id" = t.id');
  });

  it('dedupes on exactly the predicate the index enforces', () => {
    // If the sweep and the index disagreed, the migration would either cancel rows the index
    // allows, or leave a pair the index then rejects at CREATE time.
    expect(upSql).toMatch(/WHERE "tenant_id" = t\.id\s+AND "status" = 'active'\s+AND "deleted_at" IS NULL/);
  });
});

describe('#2740 the dedupe survives FORCE RLS, which the CI superuser cannot show', () => {
  it('sets the tenant GUC per tenant inside a loop over public.tenants', () => {
    // scripts/migrate.ts runs as owner-but-not-superuser on a bare pool with no tenant GUC. Under
    // 0031 + 0068 (FORCE) a bare UPDATE reports `UPDATE 0` while the index creation still sees the
    // rows — the failure 0125 and 0129 each had to be fixed for.
    expect(upSql).toMatch(/FOR t IN SELECT id FROM public\.tenants LOOP/);
    expect(upSql).toMatch(/set_config\('app\.current_tenant', t\.id::text, true\)/);
    expect(upSql).toMatch(/END LOOP/);
  });

  it('carries the is_super_admin marker guard:migration-rls recognises', () => {
    expect(upSql).toMatch(/set_config\('app\.is_super_admin', 'true', true\)/);
  });

  it('is resolved, not blind, when the house RLS-DML guard reads it', async () => {
    // The same analysis `guard:migration-rls` runs in CI, reached here so a red build shows up as
    // this line rather than as a job nobody re-runs. `blind` is the PP-058 verdict: a tenant write
    // whose rows the configured GUCs cannot see.
    const guard = await import('../../scripts/check-migration-rls-dml.mjs');
    const { ordered } = guard.orderedCorpus(MIGRATIONS);
    const { tenantScoped } = guard.collectTenantScoped(ordered.map((o: { sql: string }) => o.sql));
    const policyMap = guard.buildPolicyMap(ordered);
    const verdict = guard.analyzeFile(up, tenantScoped, policyMap);
    expect([...verdict.gucs]).toContain('app.current_tenant');
    expect(verdict.tenantWrites.length, 'expected the dedupe to write tenant-scoped tables').toBeGreaterThan(0);
    expect(verdict.blind.map((w: { kind: string; table: string }) => `${w.kind}:${w.table}`)).toEqual([]);
    expect(verdict.dynamicBlind).toBe(false);
  });

  it('is not in the guard baseline of unrepairable offenders', () => {
    const baseline = JSON.parse(
      readFileSync(join(ROOT, 'scripts/migration-rls-dml-baseline.json'), 'utf8'),
    ) as { violations: { atRisk: string[]; dynamicTarget: string[] } };
    const listed = [...baseline.violations.atRisk, ...baseline.violations.dynamicTarget]
      .filter((v) => v.includes(TAG));
    expect(listed, `0130 is a known PP-058 offender: ${listed.join(', ')}`).toEqual([]);
  });
});

describe('#2740 one predicate, written down four times, agrees', () => {
  /** The predicate as a Drizzle `sql` fragment spells it for a given column owner. */
  function drizzlePredicate(owner: string): RegExp {
    return new RegExp(
      `\\$\\{${owner}\\.status\\} = 'active' AND \\$\\{${owner}\\.deletedAt\\} IS NULL`,
    );
  }

  it('the migration creates the index with it', () => {
    expect(upSql).toContain('ON "sequence_enrollments" ("sequence_id", "contact_id")');
    expect(upSql).toMatch(/WHERE "status" = 'active' AND "deleted_at" IS NULL/);
    expect(upSql).toContain(`"${INDEX}"`);
  });

  it('the schema declares it as a UNIQUE partial index, same name, same column order', () => {
    expect(schemaSrc).toMatch(
      new RegExp(`uniqueIndex\\('${INDEX}'\\)\\s*\\.on\\(table\\.sequenceId, table\\.contactId\\)`),
    );
    expect(schemaSrc).toMatch(drizzlePredicate('table'));
    // A plain index() here would compile, run green in every mock, and enforce nothing.
    expect(schemaSrc).not.toMatch(new RegExp(`index\\('${INDEX}'\\)`));
  });

  it('the enroll route restates it as targetWhere, which is what makes its upsert legal', () => {
    expect(enrollRoute).toMatch(/targetWhere: sql`\$\{sequenceEnrollments\.status\} = 'active'/);
    expect(enrollRoute).toMatch(drizzlePredicate('sequenceEnrollments'));
  });

  it('the drift snapshot lists it, so `drizzle-kit push` cannot drop it', () => {
    const snap = JSON.parse(
      readFileSync(join(ROOT, 'tests/unit/schema-drift-snapshot-2255.json'), 'utf8'),
    ) as { indexes: string[] };
    expect(snap.indexes, `${INDEX} missing from the #2255 snapshot`).toContain(INDEX);
    expect(snap.indexes.filter((i) => i === INDEX)).toHaveLength(1);
  });

  it('is the only index in the migration chain with this name', () => {
    // A second file creating the same index name is either a duplicate to be dropped (#2264) or a
    // silent predicate disagreement; either way the chain guard should have caught it first.
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'));
    const creators = files.filter((f) =>
      readFileSync(join(MIGRATIONS, f), 'utf8').includes(`INDEX IF NOT EXISTS "${INDEX}"`));
    expect(creators).toEqual([`${TAG}.sql`]);
  });
});

describe('#2740 the writers stop claiming the table has no constraint', () => {
  const writers = [
    'app/api/tenant/segments/[id]/enroll/route.ts',
    'app/api/tenant/sequences/[id]/route.ts',
    'lib/automation/engine.ts',
  ];

  it.each(writers)('%s ends its bulk insert with onConflictDoNothing', (file) => {
    const src = readFileSync(join(ROOT, file), 'utf8');
    expect(src).toMatch(/onConflictDoNothing\(\)/);
  });

  it('no writer comment still says the unique constraint does not exist', () => {
    // The prose was the bug: six files asserted a constraint `0000_init.sql` never created, and a
    // reader who believed the newest of them would re-introduce the double-send.
    const stale = writers
      .map((f) => [f, readFileSync(join(ROOT, f), 'utf8')] as const)
      .filter(([, src]) => /no unique constraint|does not have a unique|constraint the table does not have/i.test(src))
      .map(([f]) => f);
    expect(stale, `stale #2740 prose still in: ${stale.join(', ')}`).toEqual([]);
  });
});
