import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CronTenantSweep } from '@/lib/cron/tenant-scope';

const ELIGIBLE_ON = '11111111-1111-4111-8111-111111111111';
const ELIGIBLE_OFF = '22222222-2222-4222-8222-222222222222';
// A tenant the sweep visits but that was NOT in the eligibility enumeration
// (e.g. suspended-by-status or deleted) — the route must leave it untouched.
const NOT_ELIGIBLE = '33333333-3333-4333-8333-333333333333';

let sweptTenants: string[] = [ELIGIBLE_ON, ELIGIBLE_OFF, NOT_ELIGIBLE];
let sweepResult: CronTenantSweep = { visited: 3, skipped: [], failed: [] };

// The eligibility list the route reads from the (globally readable) tenants
// master before the sweep runs.
let tenantEnumRows: Array<{ id: string; settings: unknown }> = [
  { id: ELIGIBLE_ON, settings: { ai_auto_followup: { autoAiEnabled: true } } },
  { id: ELIGIBLE_OFF, settings: { ai_auto_followup: { autoAiEnabled: false } } },
];

const mockAcquireLock = vi.fn(async () => ({ acquired: true }));
vi.mock('@/lib/cache', () => ({
  acquireLock: (key: string, ttl: number) => mockAcquireLock(key, ttl),
}));

vi.mock('@/lib/crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/crypto')>()),
  verifySecret: () => true,
}));

vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => {}) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockProcessAutoFollowups = vi.fn(async (tenantId: string) => [
  { followUpId: `${tenantId}-f1`, drafted: true },
  { followUpId: `${tenantId}-f2`, drafted: false },
]);
vi.mock('@/lib/ai/auto-followup', () => ({
  processAutoFollowups: (tenantId: string) => mockProcessAutoFollowups(tenantId),
}));

const mockSweepTenants = vi.fn(async (_context: string, body: (tenantId: string) => Promise<void>) => {
  for (const tenantId of sweptTenants) await body(tenantId);
  return sweepResult;
});
vi.mock('@/lib/cron/tenant-scope', () => ({
  sweepTenants: (context: string, body: (tenantId: string) => Promise<void>) => mockSweepTenants(context, body),
}));

// Capture the eligibility enumeration's predicate and return the tenant rows.
const enumNodes: Array<{ kind: string; cond: unknown }> = [];
vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = (cond?: unknown) => { enumNodes.push({ kind: 'from', cond }); return chain; };
      chain.where = (cond: unknown) => {
        enumNodes.push({ kind: 'where', cond });
        return Promise.resolve(tenantEnumRows);
      };
      return chain;
    },
  },
}));

/** Column names a Drizzle condition actually references. */
function referencedColumns(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 12 || node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const n of node) referencedColumns(n, out, depth + 1); return out; }
  const rec = node as Record<string, unknown>;
  if (typeof rec['columnType'] === 'string' && typeof rec['name'] === 'string') { out.push(rec['name']); return out; }
  if (Array.isArray(rec['queryChunks'])) referencedColumns(rec['queryChunks'], out, depth + 1);
  if (rec['encoder']) referencedColumns(rec['encoder'], out, depth + 1);
  return out;
}

async function runCron() {
  const { POST } = await import('@/app/api/cron/ai-auto-followup/route');
  const res = await POST({ headers: new Headers({ 'x-cron-secret': 's' }) } as never);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe('POST /api/cron/ai-auto-followup', () => {
  beforeEach(() => {
    enumNodes.length = 0;
    sweptTenants = [ELIGIBLE_ON, ELIGIBLE_OFF, NOT_ELIGIBLE];
    sweepResult = { visited: 3, skipped: [], failed: [] };
    tenantEnumRows = [
      { id: ELIGIBLE_ON, settings: { ai_auto_followup: { autoAiEnabled: true } } },
      { id: ELIGIBLE_OFF, settings: { ai_auto_followup: { autoAiEnabled: false } } },
    ];
    mockAcquireLock.mockReset();
    mockAcquireLock.mockResolvedValue({ acquired: true });
    mockSweepTenants.mockClear();
    mockProcessAutoFollowups.mockClear();
  });

  it('sweeps per tenant and processes follow-ups only for AI-enabled eligible tenants', async () => {
    const res = await runCron();

    expect(mockSweepTenants).toHaveBeenCalledWith('cron/ai-auto-followup', expect.any(Function));
    // Only the AI-enabled tenant gets worked; the disabled and non-eligible ones
    // are skipped inside the body, matching the pre-fix scope exactly.
    expect(mockProcessAutoFollowups).toHaveBeenCalledTimes(1);
    expect(mockProcessAutoFollowups).toHaveBeenCalledWith(ELIGIBLE_ON);
    expect(mockProcessAutoFollowups).not.toHaveBeenCalledWith(ELIGIBLE_OFF);
    expect(mockProcessAutoFollowups).not.toHaveBeenCalledWith(NOT_ELIGIBLE);

    expect(res.body).toEqual({
      ok: true,
      tenants_checked: 3,
      tenants_skipped: 0,
      tenants_failed: 0,
      tenants: 2,
      skipped: 1,
      drafted: 1,
      failed: 1,
    });
  });

  it('still runs its per-tenant work inside the sweep rather than a global query', async () => {
    // The eligibility enumeration touches the globally-readable tenants master,
    // but the AI drafting happens per tenant via the sweep body.
    sweptTenants = [ELIGIBLE_ON, ELIGIBLE_OFF];
    sweepResult = { visited: 2, skipped: [], failed: [] };
    await runCron();

    // processAutoFollowups is invoked per tenant (the scoping the bug lacked).
    expect(mockProcessAutoFollowups).toHaveBeenCalledTimes(1);
    // The enumeration predicate is on the tenants master (status/deleted_at),
    // proving it is an intentional global read, not a blind tenant-table scan.
    const where = enumNodes.find((n) => n.kind === 'where')?.cond;
    const cols = referencedColumns(where);
    expect(cols).toContain('deleted_at');
    expect(cols).toContain('status');
  });

  it('is not ok when a tenant failed the sweep', async () => {
    sweepResult = { visited: 1, skipped: [], failed: [{ tenantId: NOT_ELIGIBLE, error: 'boom' }] };
    const res = await runCron();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, tenants_checked: 1, tenants_failed: 1 });
  });

  it('reports tenants the sweep skipped rather than pretending a clean run', async () => {
    // The AI-enabled tenant has no acting user, so the sweep never visits it —
    // the route must surface that rather than reporting a green run.
    sweptTenants = [];
    sweepResult = { visited: 0, skipped: [{ tenantId: ELIGIBLE_ON, reason: 'no-acting-user' }], failed: [] };
    const res = await runCron();
    expect(mockProcessAutoFollowups).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      ok: true,
      tenants_checked: 0,
      tenants_skipped: 1,
      tenants_failed: 0,
      // Nothing was visited, so the by-setting `skipped` counter stays at 0 —
      // the un-visited tenant is reported through tenants_skipped instead.
      skipped: 0,
    });
  });

  it('does not sweep when the dedup lock is held', async () => {
    mockAcquireLock.mockResolvedValue({ acquired: false });
    const res = await runCron();
    expect(mockSweepTenants).not.toHaveBeenCalled();
    expect(mockProcessAutoFollowups).not.toHaveBeenCalled();
    expect(res.body).toEqual({ ok: true, skipped: true, reason: 'lock-held' });
  });
});
