/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import {
  checkVerifierTarget,
  driftCheckFailure,
  driftCheckInvocation,
  loadJournal,
} from '../../scripts/verify-migration-chain';
import type { PlannedFile } from '../../scripts/migrate-fresh';

function plan(tags: string[], action: PlannedFile['action'] = 'skip-stamped'): PlannedFile[] {
  return tags.map((tag) => ({ tag, createdAt: 1, hash: 'hash', action, reason: 'test' }));
}

describe('checkVerifierTarget (#3824)', () => {
  it('accepts a genuinely empty scratch database', () => {
    expect(checkVerifierTarget({ publicTables: 0, ledgerRows: 0, plan: plan(['0000_init'], 'replay') })).toEqual([]);
  });

  it('accepts a fully stamped scratch database as a no-op', () => {
    expect(checkVerifierTarget({ publicTables: 226, ledgerRows: 153, plan: plan(['0000_init', '0001_x']) })).toEqual([]);
  });

  it('refuses a populated schema with no ledger', () => {
    const problems = checkVerifierTarget({ publicTables: 226, ledgerRows: 0, plan: plan(['0000_init'], 'replay') });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/226 table\(s\) but no migration ledger/);
    expect(problems[0]).toMatch(/empty scratch database/);
  });

  it('refuses a half-replayed database and names the outstanding entry', () => {
    const problems = checkVerifierTarget({ publicTables: 40, ledgerRows: 2, plan: plan(['0000_init', '0003_billing_migration', '0004_x'], 'replay') });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/mid-journal: 3 of 3 entries are not stamped/);
    expect(problems[0]).toMatch(/0003_billing_migration/);
  });

  it('refuses a missing journal file even on an empty database', () => {
    const problems = checkVerifierTarget({ publicTables: 0, ledgerRows: 0, plan: plan(['0099_ghost'], 'missing-file') });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/0099_ghost\.sql/);
  });
});

describe('schema-equality gate (#3826)', () => {
  it('runs the real drift-check CLI, not a stub', () => {
    const { command, args } = driftCheckInvocation('/repo');
    expect(command).toBe('/repo/node_modules/.bin/tsx');
    expect(args).toEqual(['/repo/scripts/drift-check.ts']);
  });

  it('fails the gate on a red screen, a killed process or a spawn error', () => {
    expect(driftCheckFailure({ status: 0 })).toBeNull();
    expect(driftCheckFailure({ status: 1 })).toMatch(/schema-equality screen failed \(exit 1\)/);
    expect(driftCheckFailure({ status: null })).toMatch(/exit signal/);
    expect(driftCheckFailure({ status: null, error: new Error('ENOENT') })).toMatch(/ENOENT/);
  });
});

describe('verify-chain journal', () => {
  it('loads every journal entry the verifier must prove', () => {
    const entries = loadJournal();
    expect(entries.length).toBe(153);
    expect(entries[0]?.tag).toBe('0000_init');
    expect(entries.at(-1)?.tag).toBe('0150_approval_pending_data');
  });
});
