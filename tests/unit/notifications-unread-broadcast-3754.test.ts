/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * "Mark all read" used to publish `unread: 0` to every device even when the
 * UPDATE matched zero rows (lost tenant context), clearing badges for alerts
 * that were still unread in the database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  updatedRows: [] as unknown[],
  published: [] as unknown[][],
}));

const mockRequireAuth = vi.fn();
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: (...args: unknown[]) => mockRequireAuth(...args) };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C,>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/realtime/publish', () => ({
  publishUnreadCount: (...args: unknown[]) => { h.published.push(args); return Promise.resolve(); },
}));
vi.mock('@/drizzle/db', () => ({
  db: {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => h.updatedRows,
        }),
      }),
    }),
  },
}));

import { PATCH, DELETE } from '@/app/api/tenant/notifications/route';

const URL = 'http://localhost:3000/api/tenant/notifications';
const patch = (body: unknown) => new NextRequest(URL, {
  method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
});
const del = () => new NextRequest(URL, {
  method: 'DELETE', body: '{}', headers: { 'content-type': 'application/json' },
});

beforeEach(() => {
  h.updatedRows = [];
  h.published = [];
  mockRequireAuth.mockResolvedValue({ tenantId: 'tenant-1', userId: 'user-1' });
});

describe('notification badge broadcasts (#3754 follow-up)', () => {
  it('does not publish zero unread when mark-all-read changed nothing', async () => {
    h.updatedRows = [];
    const res = (await PATCH(patch({ action: 'mark_all_read' }), {} as never)) as NextResponse;

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, updated: 0 });
    expect(h.published).toHaveLength(0);
  });

  it('publishes zero unread only after rows were actually marked', async () => {
    h.updatedRows = [{ id: 'n-1' }, { id: 'n-2' }];
    const res = (await PATCH(patch({ action: 'mark_all_read' }), {} as never)) as NextResponse;

    expect(await res.json()).toMatchObject({ success: true, updated: 2 });
    expect(h.published).toEqual([['tenant-1', 'user-1', 0]]);
  });

  it('reports the number of notifications actually deleted', async () => {
    h.updatedRows = [{ id: 'n-1' }];
    const res = (await DELETE(del(), {} as never)) as NextResponse;

    expect(await res.json()).toMatchObject({ success: true, deleted: 1 });
    expect(h.published).toHaveLength(1);
  });
});
