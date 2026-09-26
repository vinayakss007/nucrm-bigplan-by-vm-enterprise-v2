import { describe, it, expect, vi, beforeEach } from 'vitest';

// #2119: a published form belonging to a non-active (e.g. trialing) tenant
// used to answer visitors with a bare 404 — misleading UX, no support
// signal. Now: 404 only for missing/unpublished, 403 + TENANT_NOT_ACTIVE
// for tenant status, and a structured 404 before any uuid cast.

const row: Record<string, unknown> = {
  id: 'f', name: 'F', fields: [], description: null,
  settings: {}, isActive: true, tenantStatus: 'active',
};

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      const b: Record<string, unknown> = {};
      for (const m of ['from', 'innerJoin', 'where']) b[m] = () => b;
      b['limit'] = () => Promise.resolve([{ ...row }]);
      return b;
    },
  },
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/tenant/forms/public/[id]/route';

function call(id: string) {
  return GET(new NextRequest(`http://localhost/api/tenant/forms/public/${id}`), {
    params: Promise.resolve({ id }),
  });
}

describe('GET /api/tenant/forms/public/[id] (#2119)', () => {
  beforeEach(() => {
    row.isActive = true;
    row.tenantStatus = 'active';
  });

  it('returns the form for an active tenant', async () => {
    const res = await call('0f9d0000-0000-4000-8000-000000000001');
    expect(res.status).toBe(200);
  });

  it('404s a non-entity id without touching the uuid cast', async () => {
    const res = await call('public');
    expect(res.status).toBe(404);
  });

  it('404s missing or unpublished forms', async () => {
    row.isActive = false;
    expect((await call('0f9d0000-0000-4000-8000-000000000001')).status).toBe(404);
  });

  it('403 + TENANT_NOT_ACTIVE for a non-active tenant', async () => {
    row.tenantStatus = 'trialing';
    const res = await call('0f9d0000-0000-4000-8000-000000000001');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'TENANT_NOT_ACTIVE' });
  });
});
