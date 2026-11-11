/**
 * #3246 — the inbound webhook route's tenant reads are bound, not deferred.
 *
 * `app/api/webhooks` was the last entry in `SCOPE_DEFERRALS` that named #3246:
 * 24 unbound reads, every one of them in `app/api/webhooks/inbound/route.ts`.
 * The entry said the reads could not be bound until a provider callback derived
 * a tenant — and for `inbound` the tenant was already derived. `resolveApiKey`
 * resolves the API key to a workspace (migration 0099's SELECT-only arm behind
 * `app.auth_lookup`), and the route then read `contacts`, `leads`, `deals`,
 * `companies`, `tasks`, `deal_stages`, `pipelines` and `webhook_inbound_logs`
 * through a `db.transaction()` handle that carried no `app.current_tenant`.
 * Under the tenant policies those reads answer zero rows: the webhook
 * reported `200` and stored nothing.
 *
 * This file is the ratchet for the bound state. It runs the REAL analyzer over
 * the directory with an EMPTY baseline, so a read that goes back to the bare
 * pool — or to an unbound `tx` — fails here instead of hiding behind a count.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  analyzeSource,
  loadTenantTables,
  SCOPE_DEFERRALS,
} from '../../scripts/check-portal-rls-context.mts';

const ROOT = process.cwd();
const DIR = 'app/api/webhooks';
const ROUTE = 'app/api/webhooks/inbound/route.ts';
// The stage lookups the route used to run on the bare pool now live in their
// own module, so they are scanned here too — a read that goes back to the pool
// in the new file is the same bug in a different place.
const EXTRA_FILES = ['lib/webhooks/inbound-stages.ts'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : [];
  });
}

describe('#3246 the inbound webhook route names its tenant', () => {
  it('the deferral ledger no longer excuses the webhook directory', () => {
    expect(SCOPE_DEFERRALS.map((entry) => entry.dir)).not.toContain(DIR);
  });

  it('the real analyzer finds no unbound read in that directory when nothing is excused', async () => {
    const tables = await loadTenantTables(ROOT);
    expect(tables.size).toBeGreaterThanOrEqual(100);

    const violations: ReturnType<typeof analyzeSource>['violations'] = [];
    let reads = 0;
    const files = [
      ...walk(join(ROOT, DIR)),
      ...EXTRA_FILES.map((rel) => join(ROOT, rel)),
    ];
    for (const abs of files) {
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

  it('the route opens a tenant context instead of a bare transaction', () => {
    const src = readFileSync(join(ROOT, ROUTE), 'utf8');
    // The write path names the tenant it is writing into; `db.transaction()`
    // alone carries no GUC, which is what the 24 deferred reads were.
    expect(src).toMatch(/withTenantContext\(\s*currentKey\.tenantId/);
    expect(src).not.toMatch(/await db\.transaction\(/);
  });
});
