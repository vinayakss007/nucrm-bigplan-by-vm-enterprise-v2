/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Issue #2286 — route-level proof for POST /api/tenant/deals.
 *
 * The live audit (issue body) showed:
 *   GET  /api/tenant/pipelines        -> stage id `50000000-0000-0000-0000-000000000001`
 *   POST /api/tenant/deals { stage_id: "50000000-…" } -> 400 "Invalid UUID"
 * i.e. the API handed out an ID it refused to accept back, because Zod v4's
 * `z.string().uuid()` enforces RFC-9562 version/variant nibbles and the app's
 * seeded ids use `0000` for both groups.
 *
 * After the fix (`uuidIdSchema` = `z.string().guid(...)`, version-lenient
 * 8-4-4-4-12 hex shape), the same payload passes validation and reaches the
 * DB layer, while obvious garbage is still rejected with 400 "Invalid UUID".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '20000000-0000-0000-0000-000000000001';
const SEED_STAGE_ID = '50000000-0000-0000-0000-000000000001';
const SEED_PIPELINE_ID = '40000000-0000-0000-0000-000000000001';

const insertedDealRow = {
  id: '80000000-0000-0000-0000-000000000099',
  tenantId: TENANT_ID,
  createdBy: USER_ID,
  title: 'probe-deal2',
  amount: '0',
  stageId: SEED_STAGE_ID,
  pipelineId: SEED_PIPELINE_ID,
  closeDate: null,
  contactId: null,
  companyId: null,
  assignedTo: USER_ID,
  metadata: {},
  createdAt: new Date('2026-10-03T00:00:00Z'),
  updatedAt: new Date('2026-10-03T00:00:00Z'),
};

const txMock = {
  insert: () => ({
    // `await tx.insert(x).values(y)` and `.returning()` must both be thenable.
    values: () =>
      Object.assign(Promise.resolve([insertedDealRow]), {
        returning: async () => [insertedDealRow],
      }),
  }),
  update: () => ({
    set: () => ({ where: async () => undefined }),
  }),
};

vi.mock('@/drizzle/db', () => ({
  db: {
    transaction: async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  },
}));

// withApiRoute pins a connection + wraps error handling; flatten it so the
// handler runs directly against the mocks above.
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: (h: unknown) => h }));

// Session/auth stack: mocks MUST export BOTH verifyToken AND
// getCurrentUserForToken (half-mocked session breaks transitive importers on CI).
vi.mock('@/lib/auth/session', () => ({
  verifyToken: vi.fn(async () => null),
  getCurrentUserForToken: vi.fn(async () => null),
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    userId: USER_ID,
    tenantId: TENANT_ID,
    role: 'admin',
    email: 'admin@test.com',
    permissions: {},
  })),
  requirePerm: vi.fn(() => undefined),
  can: vi.fn(() => true),
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock('@/lib/usage/middleware', () => ({ checkLimit: vi.fn(async () => null) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn(async () => undefined) }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/cache', () => ({ cache: { delByPattern: vi.fn(async () => undefined) } }));
vi.mock('@/lib/automation/engine', () => ({ evaluateAutomations: vi.fn(async () => undefined) }));

// The stage resolver normally queries dealStages; emulate "stage exists in the
// tenant" for the seeded id so the handler proceeds past the 400 guard.
vi.mock('@/lib/deals/resolve-stage', () => ({
  resolveDealStage: vi.fn(async (_db: unknown, args: Record<string, unknown>) => ({
    ok: true as const,
    stageId: args.stageId ?? SEED_STAGE_ID,
    pipelineId: SEED_PIPELINE_ID,
    stageName: 'Lead',
  })),
  stageFailureMessage: vi.fn(() => 'stage resolution failed'),
}));

import { POST } from '@/app/api/tenant/deals/route';

function post(body: unknown): NextRequest {
  return new Request('http://localhost/api/tenant/deals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('#2286 POST /api/tenant/deals accepts the app-owned seeded UUIDs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes a 50000000-prefixed stage_id + 40000000-prefixed pipeline_id through validation → 201', async () => {
    // Exact request from the issue's reproduction steps.
    const res = await POST(post({
      title: 'probe-deal2',
      stage_id: SEED_STAGE_ID,
      pipeline_id: SEED_PIPELINE_ID,
    }));
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { stage_id: string; pipeline_id: string } };
    expect(json.data.stage_id).toBe(SEED_STAGE_ID);
    expect(json.data.pipeline_id).toBe(SEED_PIPELINE_ID);
  });

  it('rejects non-UUID garbage with the unchanged 400 "Invalid UUID" contract', async () => {
    const res = await POST(post({
      title: 'probe-garbage',
      stage_id: '../../../../etc/passwd',
    }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; details: Array<{ field: string; message: string }> };
    expect(json.error).toBe('Validation failed');
    expect(json.details).toEqual(
      expect.arrayContaining([{ field: 'stage_id', message: 'Invalid UUID' }]),
    );
  });

  it('keeps rejecting sql-injection-shaped ids (leniency is hex-shape only, not a bypass)', async () => {
    const res = await POST(post({
      title: 'probe-sql',
      pipeline_id: "00000000-0000-0000-0000-000000000000; DROP TABLE deals; --",
    }));
    expect(res.status).toBe(400);
  });
});
