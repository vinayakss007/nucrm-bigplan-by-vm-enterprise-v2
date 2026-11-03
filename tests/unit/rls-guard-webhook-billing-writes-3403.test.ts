/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3403 ask 2 — "`guard:rls` must count a file covered only when a context helper *wraps* the call."
 *
 * Rule 1 hands a provider callback to `skippedAuthenticators` because a signature proves the
 * sender and there is no tenant to open with before the first statement. Rule 2 only watches
 * identity tables. Between them, `app/api/webhooks/razorpay` and `app/api/webhooks/stripe` could
 * `db.update(tenants)` on a pool whose GUCs `lib/db/pool.ts` just cleared, move zero rows — which
 * is not an error — and answer the 200 that stops the provider retrying. Nothing in the guard saw
 * a file that had never opened a context writing a table that needs one.
 *
 * Rule 4 is that check, and these tests are the two directions it has to hold in: the callback
 * that writes on the pool is a finding *even when the file mentions a helper* (the exemption the
 * old rules gave was file-level; a `withTenantContext(` two lines below does not wrap anything),
 * and the callback that writes on the transaction a helper handed it is clean.
 *
 * The real tree is asserted too, and the pin that keeps `CONTEXT_KEYED_PLATFORM_TABLES` honest:
 * `tenants` has no `tenant_id`, so the schema walk cannot see it needs a context — only 0054's
 * UPDATE arm says so. If that arm stops being a `current_setting` test, the list is a lie and a
 * test fails here rather than the guard quietly going blind again.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyse } from '../../scripts/check-rls-route-coverage.mjs';

const ROOT = join(import.meta.dirname!, '..', '..');
const RAZORPAY = 'app/api/webhooks/razorpay/route.ts';
const STRIPE = 'app/api/webhooks/stripe/route.ts';
const MIG0054 = 'drizzle/migrations/0054_rls_phase0.sql';
const MIG0088 = 'drizzle/migrations/0088_rls_bootstrap_and_isolation.sql';

const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/**
 * A one-callback repository, so rule 4 can be watched failing on a shape and only that shape.
 *
 * `tenantTables` writes a schema declaring those tables with the `tenant_id` column: rule 4's table
 * set is read off `drizzle/schema` rather than transcribed (that is what makes it notice a new
 * tenant table), so a fixture without a schema can only ever demonstrate the `tenants` half of the
 * rule — the context-keyed platform table that has no tenant_id to be found.
 */
function fixture(body: string, tenantTables: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'rls-callback-'));
  const routeDir = join(dir, 'app', 'api', 'webhooks', 'probe');
  mkdirSync(routeDir, { recursive: true });
  writeFileSync(join(routeDir, 'route.ts'), body);
  if (tenantTables.length > 0) {
    const schemaDir = join(dir, 'drizzle', 'schema');
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(
      join(schemaDir, 'probe.ts'),
      tenantTables
        .map((name) => `export const ${name} = pgTable('${name}', {\n  tenantId: uuid('tenant_id'),\n});\n`)
        .join('\n'),
    );
  }
  dirs.push(dir);
  return dir;
}

const calls = (root: string, table: string) =>
  analyse({ root, baseline: {} }).hits.filter(
    (h: { check: string; detail: string }) =>
      h.check === 'CALLBACK_UNCONTEXTED_WRITE' && h.detail.includes(`${table} written`),
  );

describe('rule 4 fails the callback that writes on the pool', () => {
  it('names the tenants UPDATE a signature-authenticated route ran with no context', () => {
    const root = fixture(`export async function POST(req: Request) {
  const event = JSON.parse(await req.text());
  const tenantId = event.payload?.notes?.tenant_id;
  await db.update(tenants).set({ status: event.status }).where(eq(tenants.id, tenantId));
}
`);
    const hits = calls(root, 'tenants');
    expect(hits).toHaveLength(1);
    expect(hits[0].file).toBe('app/api/webhooks/probe/route.ts');
    expect(hits[0].detail).toContain('#3403');
  });

  it('a chain broken across lines is still one statement (#3303 lesson, applied here)', () => {
    const hits = calls(fixture(`export async function POST(req: Request) {
  await db
    .update(tenants)
    .set({ status: 'active' })
    .where(eq(tenants.id, tenantId));
}
`), 'tenants');
    expect(hits).toHaveLength(1);
  });

  it('mentions withTenantContext and still fails, because the helper does not wrap the call', () => {
    // This is #3403 ask 2 in one case. The old exemption pattern — "the file says with*Context
    // somewhere, so the file is covered" — is exactly what let the dead callback look correct.
    const hits = calls(fixture(`export async function POST(req: Request) {
  await withTenantContext(tenantId, NO_USER_SENTINEL, async (tx) => {
    await tx.select().from(contacts);
  });
  await db.update(tenants).set({ status: 'active' }).where(eq(tenants.id, tenantId));
}
`), 'tenants');
    expect(hits).toHaveLength(1);
  });

  it('catches a tenant-scoped insert too, not only tenants', () => {
    const hits = calls(fixture(`export async function POST(req: Request) {
  await db.insert(subscriptions).values({ tenantId, status: 'active' });
}
`, ['subscriptions']), 'subscriptions');
    expect(hits).toHaveLength(1);
  });

  it('catches a raw statement against the table by SQL name', () => {
    const hits = calls(fixture(`export async function POST(req: Request) {
  await db.execute(sql\`UPDATE tenants SET status = 'active' WHERE id = \${tenantId}\`);
}
`), 'tenants');
    expect(hits).toHaveLength(1);
  });
});

describe('rule 4 passes the callback that opened a workspace first', () => {
  it('takes the write issued on the transaction the context helper returned', () => {
    expect(calls(fixture(`export async function POST(req: Request) {
  await withBillingWebhookContext(tenantId, async (tx) => {
    await applyTenantBillingPatch(tx, tenantId, { status: 'active' });
  });
}
`), 'tenants')).toEqual([]);
  });

  it('takes the context-free read: tenants_read_all is USING (true), and finding out whose event this is needs no privilege', () => {
    const root = fixture(`export async function POST(req: Request) {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.stripeCustomerId, customerId) });
  const rows = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  void rows;
}
`);
    expect(calls(root, 'tenants')).toEqual([]);
  });

  it('leaves a callback that pinned a request connection to the rule that already covers it', () => {
    // `app/api/webhooks/inbound` adopts a tenant inside resolveApiKey and wraps the handler in
    // withTenantScope, so every statement below runs on one client that carries the GUCs. Whole-
    // file exemption, same caveat rule 2 documents for a swept cron file: a write outside that
    // scope inside such a file is invisible here, and #3312 is the issue that fixes that.
    const root = fixture(`export async function POST(req: Request) {
  return withTenantScope(() => handle(req));
}
async function handle(req: Request) {
  await db.update(tenants).set({ status: 'active' }).where(eq(tenants.id, tenantId));
}
`);
    expect(calls(root, 'tenants')).toEqual([]);
  });

  it('takes a read issued as raw SQL: `execute` is on the write receiver only as a door for the SQL name test', () => {
    // The counterpart of the raw-UPDATE case above. `db.execute` is scanned because a callback can
    // write that way, and `writtenTenantTables`' raw arm (`into|update <table>`) is what tells the
    // two apart. If that arm ever grows `from`, this case is what says the read path was not
    // silently closed off.
    const root = fixture(`export async function POST(req: Request) {
  const rows = await db.execute(sql\`SELECT id FROM tenants WHERE stripe_customer_id = \${customerId}\`);
  return rows;
}
`);
    expect(calls(root, 'tenants')).toEqual([]);
  });

  it('says nothing about a route outside the callback surface, which is rules 1-3 territory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rls-notwebhook-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'app', 'api', 'tenant', 'probe'), { recursive: true });
    writeFileSync(
      join(dir, 'app', 'api', 'tenant', 'probe', 'route.ts'),
      `export async function GET() { await db.update(tenants).set({ status: 'x' }); }`,
    );
    expect(calls(dir, 'tenants')).toEqual([]);
  });
});

describe('the real tree arrives clean (#3403 ask 1)', () => {
  const result = analyse({ root: ROOT, baseline: {} });

  it('no provider callback writes a context-keyed table on the pool', () => {
    expect(
      result.hits.filter((h: { check: string }) => h.check === 'CALLBACK_UNCONTEXTED_WRITE'),
    ).toEqual([]);
  });

  it('the two callbacks rule 1 exempts are still the two this rule was written for', () => {
    const files = result.skippedAuthenticators.map((s: { file: string }) => s.file);
    expect(files).toContain(RAZORPAY);
    expect(files).toContain(STRIPE);
  });

  it('they are exempt because they open their own context, not because the guard stopped looking', () => {
    // Two entry points, one module: the reporter for a single patch, `withBillingWebhookContext`
    // spelled out where the tenant write shares a transaction with the billing row (#2530). Either
    // way the file has to be reaching for this module rather than for the pool.
    for (const rel of [RAZORPAY, STRIPE]) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      expect(src, rel).toContain('@/lib/db/billing-webhook-context');
      expect(src, rel).toMatch(/withBillingWebhookContext|createBillingWebhookReporter/);
    }
  });

  it('no rule-4 allowance exists, so nothing is being tolerated', () => {
    const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts', 'rls-preauth-baseline.json'), 'utf8'));
    expect(
      Object.keys(baseline).filter((k) => k.includes('CALLBACK_UNCONTEXTED_WRITE')),
    ).toEqual([]);
  });
});

describe('the pin that keeps the table list honest', () => {
  const up = readFileSync(join(ROOT, MIG0054), 'utf8');
  const force = readFileSync(join(ROOT, MIG0088), 'utf8');

  it('tenants still has no tenant_id to compare, so it can only be reached through a context', () => {
    expect(up).toMatch(/CREATE POLICY tenants_authenticated_update ON tenants FOR UPDATE USING \(\s*\n?\s*current_setting\('app\.current_user', true\) != ''/);
  });

  it('and it is still FORCE-RLS, so the cleared pool is subject to that policy', () => {
    expect(force).toContain('ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY');
  });
});
