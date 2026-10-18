import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Issue #2600 — the backup alert taxonomy has to be closed on both ends.
 *
 * `backup_alerts` is written by the cron routes and read by nobody: at filing, 19
 * rows sat unresolved, 13 of them `no_backup_to_verify` from 29 consecutive nightly
 * 500s. The single `resolved = true` write in the repo lived in app/api/cron/backup
 * (a job with no line in deploy/cron/crontab) and filtered alert_type = 'no_backup',
 * so the verify-family types could not be closed even by a restore that proved the
 * dump good. Unread *and* unresolvable — an append-only incident ledger.
 *
 * The defect class is the asymmetry itself: adding an alert type is a one-line edit
 * at the writer, and nothing at write time says "a resolver is also required". So
 * this is a source scan over the whole `app/` tree that re-derives both ends and
 * asserts every type written has a type that resolves it.
 *
 * Being a scan, its failure mode is silent vacuity — a regex that matches nothing
 * makes the invariant look satisfied. Hence the control test below, which feeds the
 * extractors shapes they must see and shapes they must refuse.
 */

const walkTs = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTs(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
};

type Source = { file: string; text: string };

/**
 * How far past a match to read for its evidence: enough for a helper declaration
 * and the `where(...)` of an update, short enough that a neighbouring statement
 * cannot lend it a literal it never used.
 */
const WINDOW = 700;

const slice = (text: string, from: number): string => text.slice(from, from + WINDOW);

/** `const insertAlert = (alertType: …)` and `function recordFailure(alertType: …)`. */
const WRITE_HELPER_DECL =
  /(?:async\s+)?function\s+(\w+)\s*\(\s*alertType\b|const\s+(\w+)\s*=\s*\(\s*alertType\b/g;

/** Alert types written straight into a values() literal, bypassing a helper. */
const INLINE_WRITE = /insert\(backupAlerts\)\s*\.values\(\{[^}]*alertType:\s*'([a-z_]+)'/g;

/** Types written by the helpers of one file. */
const helperWrittenTypes = (text: string): string[] => {
  const out: string[] = [];
  for (const match of text.matchAll(WRITE_HELPER_DECL)) {
    const name = match[1] ?? match[2];
    // A parameter named alertType is only a write channel if this body inserts.
    if (!/insert\(backupAlerts\)/.test(slice(text, match.index ?? 0))) continue;
    const callSite = new RegExp(`\\b${name}\\(\\s*'([a-z_]+)'`, 'g');
    for (const call of text.matchAll(callSite)) out.push(call[1] as string);
  }
  return out;
};

const writtenTypes = (source: Source): string[] => [
  ...helperWrittenTypes(source.text),
  ...[...source.text.matchAll(INLINE_WRITE)].map((m) => m[1] as string),
];

/** `[...VERIFY_ALERT_TYPES]` and `['a', 'b']` both appear inside inArray(…). */
const CONST_ARRAY = /const\s+(\w+)\s*=\s*\[([^\]]*)\]/g;

const constArrayMembers = (text: string, name: string): string[] => {
  for (const decl of text.matchAll(CONST_ARRAY)) {
    if (decl[1] !== name) continue;
    return [...decl[2].matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
  }
  return [];
};

const RESOLVE_BLOCK = /update\(backupAlerts\)/g;

/** Alert types this file can mark resolved (only from `resolved: true` writes). */
const resolvedTypes = (source: Source): string[] => {
  const out: string[] = [];
  for (const match of source.text.matchAll(RESOLVE_BLOCK)) {
    const block = slice(source.text, match.index ?? 0);
    if (!/resolved:\s*true/.test(block)) continue;
    for (const eqMatch of block.matchAll(/eq\(backupAlerts\.alertType,\s*'([a-z_]+)'\)/g)) {
      out.push(eqMatch[1] as string);
    }
    for (const inArray of block.matchAll(/inArray\(backupAlerts\.alertType,\s*\[([^\]]*)\]/g)) {
      const body = inArray[1] as string;
      const spread = /\.\.\.(\w+)/.exec(body)?.[1];
      if (spread) out.push(...constArrayMembers(source.text, spread));
      out.push(...[...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string));
    }
  }
  return [...new Set(out)];
};

const load = (files: string[]): Source[] => files.map((file) => ({ file, text: readFileSync(file, 'utf8') }));

const CRON_SOURCES = load(walkTs('app/api/cron'));
const APP_SOURCES = load(walkTs('app'));

const SYNTH = (text: string): Source => ({ file: 'synthetic/route.ts', text });

describe('#2600 backup alert types are written and resolved symmetrically', () => {
  it('scans a non-trivial tree', () => {
    // Without this the invariant below could pass because nothing was read.
    expect(CRON_SOURCES.length).toBeGreaterThanOrEqual(20);
    expect(APP_SOURCES.length).toBeGreaterThan(300);
    expect(CRON_SOURCES.map((s) => s.file)).toContain('app/api/cron/backup-verify/route.ts');
    expect(CRON_SOURCES.map((s) => s.file)).toContain('app/api/cron/backup-health/route.ts');
  });

  it('recognises the shapes it is looking for, and refuses the near-misses (control)', () => {
    const writing = SYNTH(`
      const insertAlert = (alertType: string, message: string) =>
        withSecurityContext((tx) => tx.insert(backupAlerts).values({ alertType, message }));
      await insertAlert('no_backup', 'x');
      await insertAlert(
        'verify_failed',
        joined,
      );
      async function recordFailure(alertType: string, message: string): Promise<void> {
        await withSecurityContext((tx) => tx.insert(backupAlerts).values({ alertType, message }));
      }
      await recordFailure('verify_error', reason);
      await logSomethingElse('not_an_alert_type', reason);
      inline: await tx.insert(backupAlerts).values({ alertType: 'no_backup_to_verify', message });
    `);
    expect(writtenTypes(writing).sort()).toEqual([
      'no_backup',
      'no_backup_to_verify',
      'verify_error',
      'verify_failed',
    ]);

    // A helper shaped like the writers but not writing to the table is not one.
    expect(
      writtenTypes(SYNTH(`
        const notify = (alertType: string, message: string) => logError({ context: alertType, message });
        await notify('no_backup', 'x');
      `)),
    ).toEqual([]);

    const resolving = SYNTH(`
      await tx.update(backupAlerts)
        .set({ resolved: true, resolvedAt: new Date() })
        .where(and(eq(backupAlerts.alertType, 'no_backup'), eq(backupAlerts.resolved, false)));
      const VERIFY_ALERT_TYPES = ['no_backup_to_verify', 'verify_failed', 'verify_error'] as const;
      await tx.update(backupAlerts)
        .set({ resolved: true })
        .where(and(eq(backupAlerts.resolved, false), inArray(backupAlerts.alertType, [...VERIFY_ALERT_TYPES])));
    `);
    expect(resolvedTypes(resolving).sort()).toEqual([
      'no_backup',
      'no_backup_to_verify',
      'verify_error',
      'verify_failed',
    ]);

    // An update that *reads* resolved = false resolves nothing.
    expect(
      resolvedTypes(SYNTH(`
        await tx.update(backupAlerts)
          .set({ message: 'still open' })
          .where(and(eq(backupAlerts.alertType, 'no_backup'), eq(backupAlerts.resolved, false)));
      `)),
    ).toEqual([]);
    // Neither does a resolve that targets another table entirely.
    expect(
      resolvedTypes(SYNTH(`
        await tx.update(errors)
          .set({ resolved: true })
          .where(eq(backupAlerts.alertType, 'no_backup'));
      `)),
    ).toEqual([]);
  });

  it('the writers still produce exactly the four types live in the table today', () => {
    // Measured under app.is_super_admin at filing: 13 no_backup_to_verify,
    // 5 no_backup, 1 verify_failed — the four types below are the whole vocabulary.
    // Pinning the set is what turns a new writer into a review, not a silent leak.
    const written = [...new Set(CRON_SOURCES.flatMap(writtenTypes))].sort();
    expect(written).toEqual(['no_backup', 'no_backup_to_verify', 'verify_error', 'verify_failed']);
  });

  it('gives every type a resolver that can close it', () => {
    const written = [...new Set(CRON_SOURCES.flatMap(writtenTypes))];
    const resolvable = new Set(APP_SOURCES.flatMap(resolvedTypes));
    const orphaned = written.filter((type) => !resolvable.has(type));
    expect(orphaned, `unresolvable backup alert types: ${orphaned.join(', ')}`).toEqual([]);
  });

  it('keeps each resolver honest about the evidence it actually has', () => {
    const byFile = new Map(APP_SOURCES.map((s) => [s.file, resolvedTypes(s)]));
    // A passing restore proves the artefact is restorable; it does not prove a
    // dump ran, so backup-verify must not close no_backup on cron/backup's behalf.
    expect([...(byFile.get('app/api/cron/backup-verify/route.ts') ?? [])].sort()).toEqual([
      'no_backup_to_verify',
      'verify_error',
      'verify_failed',
    ]);
    expect(byFile.get('app/api/cron/backup/route.ts')).toEqual(['no_backup']);
  });
});
