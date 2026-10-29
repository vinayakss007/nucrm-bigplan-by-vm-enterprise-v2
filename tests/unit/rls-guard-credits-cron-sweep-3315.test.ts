/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3315 asked for three things: put a context under the three cron recipient
 * reads, make an empty recipient read a failure, and — once both had happened —
 * delete the sites from `scripts/rls-preauth-baseline.json`.
 *
 * The first two are already true on `main`. `app/api/cron/{contract-renewal-check,
 * subscription-renewal-check,sla-check}/route.ts` each run their work inside
 * `sweepTenants(...)`, which owns one `withPinnedConnection` for the whole sweep
 * and calls `setTenantContext(tenantId, actingUserId)` on it before the body, with
 * `resolveActingUser` preferring a real active `tenant_members` row precisely
 * because `users_tenant_member_read` admits a reader only when
 * `app.current_user` is one (0088). The empty-recipient reporting landed in #3357.
 *
 * What was NOT true is ask 3, and it could not be: rule 2 decides a file is on the
 * anonymous surface by testing the file's text against `CONTEXT_ESTABLISHED_RE`,
 * and that list names `withPinnedConnection` and `requireAuth` but not
 * `sweepTenants`. So the guard kept counting three contextualised reads as
 * tolerated findings, and a ratchet that tolerates correct code stops being
 * evidence for anything.
 *
 * This suite pins the correction in both directions: the three sites disappear
 * from rule 2, and the exemption is only valid for as long as the helper really
 * does the two things rule 2 already trusts — so if `lib/cron/tenant-scope.ts`
 * ever stops pinning or stops setting the GUC, a test fails here instead of the
 * guard quietly starting to lie.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyse, readBaseline } from '../../scripts/check-rls-route-coverage.mjs';

const ROOT = join(import.meta.dirname!, '..', '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'rls-preauth-baseline.json');
const CONTRACT = 'app/api/cron/contract-renewal-check/route.ts';
const SUBSCRIPTION = 'app/api/cron/subscription-renewal-check/route.ts';
const SLA = 'app/api/cron/sla-check/route.ts';
const SCIM_LIST = 'app/api/scim/v2/Users/route.ts';
const SCIM_ITEM = 'app/api/scim/v2/Users/[id]/route.ts';
const CRON_ROUTES = [CONTRACT, SUBSCRIPTION, SLA];

const baseline = readBaseline(BASELINE_PATH);
const raw = analyse({ root: ROOT, baseline: {} });
const current = analyse({ root: ROOT, baseline });

const hitsIn = (file: string) => raw.hits.filter((h: { file: string }) => h.file === file);

/** A one-route repository, so a guard rule can be watched failing. */
function fixture(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rls-sweep-'));
  const routeDir = join(dir, 'app', 'api', 'cron', 'probe');
  mkdirSync(routeDir, { recursive: true });
  writeFileSync(join(routeDir, 'route.ts'), body);
  return dir;
}

describe('the guard credits a cron sweep as the context it is (#3315)', () => {
  for (const file of CRON_ROUTES) {
    it(`${file} is no longer counted as an un-contexted identity read`, () => {
      expect(hitsIn(file)).toEqual([]);
    });
  }

  it('leaving the two SCIM handlers as the only anonymous-surface sites', () => {
    // Nothing else moved: the fusion in #3303 still reports exactly those ten, so
    // this cannot be the exemption swallowing a real finding somewhere else.
    const files = [...new Set(raw.hits.map((h) => h.file))].sort();
    expect(files).toEqual([SCIM_ITEM, SCIM_LIST].sort());
    expect(raw.hits).toHaveLength(10);
  });

  it('and the baseline carries no allowance for a site that is not a finding', () => {
    for (const file of CRON_ROUTES) {
      expect(baseline[`${file}|PREAUTH_UNCONTEXTED_READ`], `${file} must not be tolerated`).toBeUndefined();
      expect(baseline._reasons?.[`${file}|PREAUTH_UNCONTEXTED_READ`]).toBeUndefined();
    }
    // An entry left behind after its site stopped being a finding is
    // `BASELINE_STALE`, so the run being clean is itself the proof.
    expect(current.findings).toEqual([]);
    expect(current.allowed).toBe(raw.hits.length);
  });
});

describe('the exemption is earned by what the helper actually does', () => {
  it('lib/cron/tenant-scope.ts pins a connection and sets the tenant GUC', () => {
    // These are the two calls rule 2 already treats as a context
    // (`withPinnedConnection`, and `setTenantContext` writing
    // app.current_tenant / app.current_user). If either ever leaves the helper,
    // the name in the guard's list becomes a claim about code that no longer
    // holds — and this test is what notices, not a reviewer six months on.
    const src = readFileSync(join(ROOT, 'lib', 'cron', 'tenant-scope.ts'), 'utf8');
    expect(src).toMatch(/\bwithPinnedConnection\s*\(/);
    expect(src).toMatch(/\bsetTenantContext\s*\(/);
  });

  it('a route that imports sweepTenants and never calls it is still screened', () => {
    const dir = fixture(
      "import { sweepTenants } from '@/lib/cron/tenant-scope';\n"
      + "const rows = await db.select({ id: users.id }).from(users);\n",
    );
    try {
      expect(analyse({ root: dir, baseline: {} }).hits).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a route that calls it and reads users on the pinned pool inside the sweep is not', () => {
    const dir = fixture(
      "const sweep = await sweepTenants('cron/probe', async (tenantId) => {\n"
      + "  const rows = await db.select({ id: users.id }).from(users);\n"
      + "});\n",
    );
    try {
      expect(analyse({ root: dir, baseline: {} }).hits).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the read the helper hands off to a module-level function counts too, because the pin is per connection', () => {
    // `app/api/cron/sla-check/route.ts:291` is the case this exemption exists for:
    // the escalation read is not lexically inside the callback, it is in
    // `sendBreachNotification`, awaited from inside it — and it runs on the sweep's
    // pinned, contextualised connection either way. A rule keyed on nesting would
    // have been wrong here, which is why rule 2's test is per file.
    const dir = fixture(
      "const sweep = await sweepTenants('cron/probe', async (tenantId) => {\n"
      + "  await notify(ticket);\n"
      + "});\n"
      + "async function notify(t) {\n"
      + "  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, t.assignedTo));\n"
      + "  return user;\n"
      + "}\n",
    );
    try {
      expect(analyse({ root: dir, baseline: {} }).hits).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
