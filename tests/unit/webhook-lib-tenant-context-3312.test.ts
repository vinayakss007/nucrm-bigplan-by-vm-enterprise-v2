/**
 * #3312 — the portal RLS-context guard follows anonymous routes into `lib/`, and
 * the reads it found there are bound rather than deferred.
 *
 * #3385 widened `PINNED_TARGETS` to the lib/ modules an anonymous webhook route
 * calls. That surfaced 24 tenant-keyed statements that had never been counted:
 * `lib/webhooks/delivery.ts` (11), `lib/webhooks/dlq.ts` (10),
 * `lib/webhooks/field-mapping.ts` (1) and `lib/stripe-subscription-sync.ts` (2).
 * They were parked in `SCOPE_DEFERRALS` with the note "each helper must receive
 * and bind a tenant context".
 *
 * This file is the ratchet for that note. It runs the REAL analyzer over those
 * seven modules with an EMPTY baseline, so a single read that goes back to the
 * bare pool — or to an unbound `tx` parameter — fails here instead of hiding
 * behind a count.
 *
 * Why the pool is the bug, not a style point: `webhook_deliveries`,
 * `dead_letter_queue`, `webhook_field_mappings` and `subscriptions` are all
 * FORCE-RLS. A read on the bare pool carries no `app.current_tenant`, so the
 * policy admits zero rows and the helper reports "nothing found" — a failed
 * delivery that never reaches the DLQ, a stats panel that says zero, an inbound
 * mapping that silently stops applying, a Stripe row that never updates.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  analyzeSource,
  loadTenantTables,
  SCOPE_DEFERRALS,
} from '../../scripts/check-portal-rls-context.mts';

const ROOT = process.cwd();
const BOUND_FILES = [
  'lib/webhooks/delivery.ts',
  'lib/webhooks/dlq.ts',
  'lib/webhooks/event-catalog.ts',
  'lib/webhooks/field-mapping.ts',
  'lib/webhooks/idempotency.ts',
  'lib/webhooks/inbound-auth.ts',
  'lib/stripe-subscription-sync.ts',
];

describe('#3312 the lib/ webhook surface is bound, not deferred', () => {
  it('the deferral ledger no longer excuses lib/webhooks or stripe sync', () => {
    const dirs = SCOPE_DEFERRALS.map((entry) => entry.dir);
    expect(dirs).not.toContain('lib/webhooks');
    expect(dirs).not.toContain('lib/stripe-subscription-sync.ts');
  });

  it('the real analyzer finds no unbound read in those files when nothing is excused', async () => {
    const tables = await loadTenantTables(ROOT);
    expect(tables.size).toBeGreaterThanOrEqual(100);

    const violations: ReturnType<typeof analyzeSource>['violations'] = [];
    let reads = 0;
    for (const rel of BOUND_FILES) {
      const abs = join(ROOT, rel);
      const result = analyzeSource(
        relative(ROOT, abs).split('\\').join('/'),
        readFileSync(abs, 'utf8'),
        tables,
        [],
        ROOT,
      );
      violations.push(...result.violations);
      reads += result.reads;
    }

    // The screen actually looked: a run that reads nothing passes everything.
    expect(reads).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  }, 120_000);
});
