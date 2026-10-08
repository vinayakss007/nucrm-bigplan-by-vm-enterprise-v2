/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Unit tests for the pure assertions behind
 * `scripts/check-fresh-install-sequence.mts` (#2450 AC1/AC2).
 *
 * The script itself needs a live PostgreSQL, so it can only run in CI; these
 * tests make sure that when it does run, it is actually looking at the right
 * things. The measured numbers below are the real ones: the pushed schema
 * (`227 tables / 0 policies / 77 functions / 0 ledger rows`) is the bug, and
 * the built schema (`226 / 269 / 226 / 100 / 122`) is what a fresh install is
 * owed.
 */
import { describe, it, expect } from 'vitest';
import {
  checkBootstrapRefusal,
  checkCompleteBuild,
  checkCoherentRefusal,
  MIN_POLICIES,
  MIN_RLS_TABLES,
  type ProbeCounts,
} from '../../scripts/check-fresh-install-sequence.mts';

const pushedCounts: ProbeCounts = { tables: 227, policies: 0, rlsEnabledTables: 0, functions: 77, ledgerRows: 0 };
const builtCounts: ProbeCounts = { tables: 226, policies: 269, rlsEnabledTables: 226, functions: 100, ledgerRows: 122 };

describe('checkCoherentRefusal (#2450 AC1)', () => {
  it('accepts a refusal that names the source and the way out', () => {
    expect(checkCoherentRefusal({
      rc: 1,
      stdout: '[migrate] Recovery: schema already exists but the migration ledger is empty.\n',
      stderr: '[migrate] ERROR: this schema was built by `drizzle-kit push` (db:push/db:sync), not by these migrations.\n'
        + '[migrate] Refusing BEFORE stamping: no ledger row was written, no migration SQL ran.\n'
        + '[migrate]   npm run db:bootstrap\n',
    })).toEqual([]);
  });

  it('rejects a stamp-verify-rollback run, which is what shipped (#2450)', () => {
    const problems = checkCoherentRefusal({
      rc: 1,
      stdout: '[migrate] This database was provisioned with db:push/db:sync or restored from a dump.'
        + ' Stamping the journal as applied… Seeding 122 entries...\n'
        + '[migrate] Recovery complete — no migration SQL was executed.\n',
      stderr: '[migrate] ERROR: Post-stamp verification FAILED — 1 expected object(s) missing:\n'
        + '[migrate] The stamp was rolled back (ledger left empty).\n',
    });
    // Non-zero exit alone is NOT coherence: this run looked like a failure and
    // still left the database labelled as neither migrated nor unmigrated. It
    // also conflated the two provisioning sources and named no way out, which
    // is the other half of what #2450 asked for.
    expect(problems).toHaveLength(4);
    expect(problems.join('\n')).toContain('printed "Recovery complete"');
    expect(problems.join('\n')).toContain('stamped first and failed at verification');
    expect(problems.join('\n')).toContain('does not name `drizzle-kit push`');
    expect(problems.join('\n')).toContain('does not name the command that completes');
  });

  it('rejects exit 0 over a pushed schema', () => {
    const problems = checkCoherentRefusal({
      rc: 0, stdout: '[migrate] All migrations applied successfully\n', stderr: '',
    });
    expect(problems[0]).toContain('exited 0');
    expect(problems.some((p) => p.includes('reported success'))).toBe(true);
  });

  it('rejects a refusal that leaves the operator with nowhere to go', () => {
    expect(checkCoherentRefusal({ rc: 1, stdout: '', stderr: 'ERROR: schema is not migrated' }))
      .toEqual([
        'the refusal does not name `drizzle-kit push` as the provisioning source',
        'the refusal does not name the command that completes the build',
      ]);
  });
});

describe('checkCompleteBuild (#2450 AC2)', () => {
  it('accepts the measured output of a journal replay', () => {
    expect(checkCompleteBuild(builtCounts, 122)).toEqual([]);
  });

  it('rejects the pushed schema it was written to catch', () => {
    const problems = checkCompleteBuild(pushedCounts, 122);
    expect(problems).toHaveLength(3);
    expect(problems.join('\n')).toContain(`0 RLS policies, expected at least ${MIN_POLICIES}`);
    expect(problems.join('\n')).toContain(`0 RLS-enabled tables, expected at least ${MIN_RLS_TABLES}`);
    expect(problems.join('\n')).toContain('ledger holds 0 row(s) but the journal has 122 entries');
    // The 22 missing SQL functions are NOT counted here: db:bootstrap's own
    // headline-object diff is the extension-independent way to find them, and
    // a raw catalog count would be wrong on a managed PostgreSQL.
  });

  it('rejects a build whose ledger is short of the journal even when RLS ran', () => {
    const problems = checkCompleteBuild({ ...builtCounts, ledgerRows: 121 }, 122);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('the next db:migrate would replay');
  });
});

describe('checkBootstrapRefusal (#2450 — bootstrap never reconciles or wipes)', () => {
  it('accepts an explained refusal', () => {
    expect(checkBootstrapRefusal({
      rc: 1, stdout: '',
      stderr: '[bootstrap] ERROR: db:bootstrap builds an EMPTY database from the journal and will not\n'
        + '[bootstrap] touch one that already has state.\n',
    })).toEqual([]);
  });

  it('rejects a bootstrap that ran over a pushed schema', () => {
    expect(checkBootstrapRefusal({ rc: 0, stdout: '', stderr: '' })).toEqual([
      'db:bootstrap ran over a non-empty schema instead of refusing',
      'the bootstrap refusal does not explain what it refused and why',
    ]);
  });
});
