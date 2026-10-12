import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `data_retention_policies` refuses any `entity_type` outside the five values its
 * CHECK constraint `chk_data_retention_policies_entity_type` lists (measured live:
 * contacts, deals, activities, emails, audit_logs — migration 0050). Both the POST
 * schema here and the Settings → Compliance entity dropdown used to offer `notes`
 * and `tasks` as well, so those two options could never be saved: the row died on
 * the constraint and the customer saw a refusal with no explanation. The table has
 * never held a row, which is the fingerprint of that.
 *
 * The zod enum is the only thing standing between the dropdown and Postgres, so it
 * has to carry exactly the accepted vocabulary — no wider (an option that cannot
 * persist) and no narrower (a value the table would accept being rejected here).
 */

const mockCtx = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  isAdmin: true,
  // requireModule() short-circuits for the super admin, so the module gate needs
  // no table of its own in this harness.
  isSuperAdmin: true,
};
const mockRequireAuth = vi.fn();

let selectResult: unknown[] = [];
let insertedValues: Record<string, unknown> | null = null;

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => selectResult),
    })),
  })),
  insert: vi.fn(() => ({
    values: vi.fn((v: Record<string, unknown>) => {
      insertedValues = v;
      return {
        returning: vi.fn(async () => [{ id: 'policy-1', ...v, updatedAt: new Date('2026-01-01T00:00:00.000Z') }]),
      };
    }),
  })),
};

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
}));
vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));

const { POST } = await import('@/app/api/tenant/compliance/retention/route');

const ACCEPTED_ENTITY_TYPES = ['contacts', 'deals', 'activities', 'emails', 'audit_logs'] as const;

type Req = import('next/server').NextRequest;
function request(body: unknown): Req {
  return new Request('http://localhost/api/tenant/compliance/retention', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Req;
}

function policyBody(entityType: string) {
  return { entityType, retentionDays: 365, action: 'archive' };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(mockCtx);
  selectResult = [];
  insertedValues = null;
});

describe('POST /api/tenant/compliance/retention — entityType vocabulary', () => {
  it.each(['notes', 'tasks'])('rejects "%s" with a 400 validation response, not a server fault', async (entityType) => {
    const res = await POST(request(policyBody(entityType)));
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(json.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'entityType' })])
    );
    // The whole point: the request never reaches the table, so the CHECK is not
    // the thing that has to notice, and no 5xx path is taken.
    expect(insertedValues).toBeNull();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it.each(ACCEPTED_ENTITY_TYPES)('accepts "%s", the value the live CHECK allows', async (entityType) => {
    const res = await POST(request(policyBody(entityType)));
    expect(res.status).toBe(201);
    expect(insertedValues).toMatchObject({ entityType, tenantId: 'tenant-1' });
  });
});

describe('Settings → Compliance entity dropdown', () => {
  it('offers exactly the entity types the API accepts', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('app/tenant/settings/compliance/page.tsx', 'utf8');
    const block = src.slice(src.indexOf('value={newPolicy.entityType}'));
    const options = [...block.slice(0, block.indexOf('</select>')).matchAll(/<option value="([^"]+)">/g)]
      .map(m => m[1]);

    expect(options).toEqual([...ACCEPTED_ENTITY_TYPES]);
  });
});
