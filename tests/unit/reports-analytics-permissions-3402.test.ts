/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3402 (PR-2E) — Reports and analytics permission gates.
 *
 * Verifies that the catalog ids `reports.view` and `reports.create` are strictly
 * enforced on:
 *   - GET  /api/tenant/reports (requires reports.view)
 *   - POST /api/tenant/reports/builder (requires reports.view)
 *   - GET  /api/tenant/reports/builder (requires reports.view)
 *   - POST /api/tenant/reports/run (requires reports.view)
 *   - GET  /api/tenant/analytics/scheduled-reports (requires reports.view)
 *   - POST /api/tenant/analytics/scheduled-reports (requires reports.create)
 *   - GET  /api/tenant/analytics/overview (requires reports.view)
 *   - GET  /api/tenant/analytics/usage (requires reports.view)
 *   - GET  /api/tenant/reports/conversion-funnel (requires reports.view)
 *   - GET  /api/tenant/reports/deal-velocity (requires reports.view)
 *   - GET  /api/tenant/reports/sla-compliance (requires reports.view)
 *   - GET  /api/tenant/reports/team-performance (requires reports.view)
 *   - GET  /api/tenant/reports/win-loss (requires reports.view)
 *
 * An unprivileged tenant member (e.g., sales_rep where reports.view is false)
 * receives 403 and the handler performs no query execution or write.
 * Users with the explicit grant, admins, and superadmins pass the permission gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getReports } from '@/app/api/tenant/reports/route';
import {
  GET as getReportBuilder,
  POST as postReportBuilder,
} from '@/app/api/tenant/reports/builder/route';
import { POST as postReportRun } from '@/app/api/tenant/reports/run/route';
import {
  GET as getScheduledReports,
  POST as postScheduledReports,
} from '@/app/api/tenant/analytics/scheduled-reports/route';
import { GET as getAnalyticsOverview } from '@/app/api/tenant/analytics/overview/route';
import { GET as getAnalyticsUsage } from '@/app/api/tenant/analytics/usage/route';
import { GET as getConversionFunnel } from '@/app/api/tenant/reports/conversion-funnel/route';
import { GET as getDealVelocity } from '@/app/api/tenant/reports/deal-velocity/route';
import { GET as getSlaCompliance } from '@/app/api/tenant/reports/sla-compliance/route';
import { GET as getTeamPerformance } from '@/app/api/tenant/reports/team-performance/route';
import { GET as getWinLoss } from '@/app/api/tenant/reports/win-loss/route';

interface AuthCtx {
  tenantId: string;
  userId: string;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  permissions?: Record<string, boolean>;
}

let mockAuthCtx: AuthCtx = {
  tenantId: 'tenant-test-01',
  userId: 'user-test-01',
  isAdmin: false,
  isSuperAdmin: false,
  permissions: {},
};

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <T>(h: T) => h,
}));

vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: vi.fn(async () => null),
}));

vi.mock('@/lib/api/read-rate-limit', () => ({
  rateLimitRead: vi.fn(async () => null),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => null),
}));

vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(async () => undefined),
  tenantMeta: vi.fn(() => ({})),
}));

vi.mock('@/lib/auth/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return {
    requireAuth: vi.fn(async () => mockAuthCtx),
    can: (ctx: AuthCtx, perm: string): boolean => {
      if (ctx.isSuperAdmin || ctx.isAdmin) return true;
      return ctx.permissions?.['all'] === true || ctx.permissions?.[perm] === true;
    },
    requirePerm: (ctx: AuthCtx, perm: string) => {
      if (ctx.isSuperAdmin || ctx.isAdmin) return null;
      if (ctx.permissions?.['all'] === true || ctx.permissions?.[perm] === true) return null;
      return NextResponse.json({ error: `Permission denied: ${perm} required` }, { status: 403 });
    },
  };
});

// Mock database to ensure no query runs if permission is denied
const dbSelectMock = vi.fn(() => ({
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  groupBy: vi.fn().mockReturnThis(),
  then: (resolve: (v: unknown) => unknown) => resolve([]),
}));

const dbInsertMock = vi.fn(() => ({
  values: vi.fn(() => ({
    returning: vi.fn(() => Promise.resolve([{ id: 'mock-id' }])),
  })),
}));

const dbExecuteMock = vi.fn(async () => ({ rows: [] }));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => dbSelectMock(),
    insert: () => dbInsertMock(),
    execute: () => dbExecuteMock(),
  },
}));

vi.mock('@/app/api/tenant/reports/run/route', async () => {
  const actual = await vi.importActual<typeof import('@/app/api/tenant/reports/run/route')>('@/app/api/tenant/reports/run/route');
  return {
    ...actual,
    runReportForTenant: vi.fn(async () => ({ rows: [], reportType: 'contacts' })),
  };
});

function createReq(url: string, method: string = 'GET', body?: unknown): NextRequest {
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  return new NextRequest(new URL(url, 'http://localhost:3000'), init);
}

describe('#3402 (PR-2E) Reports & Analytics permission enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthCtx = {
      tenantId: 'tenant-test-01',
      userId: 'user-test-01',
      isAdmin: false,
      isSuperAdmin: false,
      permissions: {},
    };
  });

  describe('reports.view required routes', () => {
    const viewRoutes = [
      { name: 'GET /api/tenant/reports', fn: () => getReports(createReq('/api/tenant/reports')) },
      { name: 'POST /api/tenant/reports/builder', fn: () => postReportBuilder(createReq('/api/tenant/reports/builder', 'POST', { entity: 'contacts', groupBy: 'lead_status' })) },
      { name: 'GET /api/tenant/reports/builder', fn: () => getReportBuilder(createReq('/api/tenant/reports/builder')) },
      { name: 'POST /api/tenant/reports/run', fn: () => postReportRun(createReq('/api/tenant/reports/run', 'POST', { entity: 'contacts' })) },
      { name: 'GET /api/tenant/analytics/scheduled-reports', fn: () => getScheduledReports(createReq('/api/tenant/analytics/scheduled-reports')) },
      { name: 'GET /api/tenant/analytics/overview', fn: () => getAnalyticsOverview(createReq('/api/tenant/analytics/overview')) },
      { name: 'GET /api/tenant/analytics/usage', fn: () => getAnalyticsUsage(createReq('/api/tenant/analytics/usage')) },
      { name: 'GET /api/tenant/reports/conversion-funnel', fn: () => getConversionFunnel(createReq('/api/tenant/reports/conversion-funnel')) },
      { name: 'GET /api/tenant/reports/deal-velocity', fn: () => getDealVelocity(createReq('/api/tenant/reports/deal-velocity')) },
      { name: 'GET /api/tenant/reports/sla-compliance', fn: () => getSlaCompliance(createReq('/api/tenant/reports/sla-compliance')) },
      { name: 'GET /api/tenant/reports/team-performance', fn: () => getTeamPerformance(createReq('/api/tenant/reports/team-performance')) },
      { name: 'GET /api/tenant/reports/win-loss', fn: () => getWinLoss(createReq('/api/tenant/reports/win-loss')) },
    ];

    it.each(viewRoutes)('$name denies access (403) when reports.view is missing', async ({ fn }) => {
      mockAuthCtx.permissions = {};
      const res = await fn();
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('Permission denied: reports.view required');
    });

    it.each(viewRoutes)('$name allows access when reports.view is granted', async ({ fn }) => {
      mockAuthCtx.permissions = { 'reports.view': true };
      const res = await fn();
      expect(res.status).not.toBe(403);
    });

    it.each(viewRoutes)('$name allows access for admin', async ({ fn }) => {
      mockAuthCtx.isAdmin = true;
      const res = await fn();
      expect(res.status).not.toBe(403);
    });
  });

  describe('reports.create required on POST /api/tenant/analytics/scheduled-reports', () => {
    const postScheduled = () =>
      postScheduledReports(
        createReq('/api/tenant/analytics/scheduled-reports', 'POST', {
          name: 'Weekly Pipeline',
          type: 'pipeline',
          frequency: 'weekly',
          recipients: ['lead@example.com'],
        }),
      );

    it('denies (403) when reports.create is missing', async () => {
      mockAuthCtx.permissions = { 'reports.view': true }; // Has view, but not create
      const res = await postScheduled();
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('Permission denied: reports.create required');
      expect(dbInsertMock).not.toHaveBeenCalled();
    });

    it('allows (201) when reports.create is granted', async () => {
      mockAuthCtx.permissions = { 'reports.create': true };
      const res = await postScheduled();
      expect(res.status).toBe(201);
    });

    it('allows (201) for admin', async () => {
      mockAuthCtx.isAdmin = true;
      const res = await postScheduled();
      expect(res.status).toBe(201);
    });
  });
});
