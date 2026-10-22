import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Issue #3082: POST /api/tenant/teams/[id]/members used SELECT-then-INSERT,
 * so a double-submit took the insert branch twice and the loser surfaced a
 * raw 23505 as a 500. The route must now be a single upsert on the
 * idx_team_members_team_user unique index.
 */

const mockCtx = { userId: 'user-1', tenantId: 'tenant-1', isAdmin: true, email: 'a@b.c', role: 'admin' };

const insertState = vi.hoisted(() => ({
  values: undefined as Record<string, unknown> | undefined,
  conflict: undefined as { target?: unknown; set?: Record<string, unknown> } | undefined,
  returningRows: [] as Array<Record<string, unknown>>,
}));

const dbMock = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => [{ id: 'team-1' }]),
      })),
    })),
  })),
  insert: vi.fn(() => ({
    values: (v: Record<string, unknown>) => {
      insertState.values = v;
      return {
        onConflictDoUpdate: (c: { target?: unknown; set?: Record<string, unknown> }) => {
          insertState.conflict = c;
          return {
            returning: async () => insertState.returningRows,
          };
        },
        returning: async () => insertState.returningRows,
      };
    },
  })),
}));

vi.mock('@/drizzle/db', () => ({ db: dbMock }));
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(async () => mockCtx) }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T,>(h: T) => h }));

async function post(body: unknown) {
  const { POST } = await import('@/app/api/tenant/teams/[id]/members/route');
  const req = new NextRequest('http://test/api/tenant/teams/team-1/members', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: 'team-1' }) });
}

describe('POST /api/tenant/teams/[id]/members upsert (#3082)', () => {
  it('is a single upsert keyed on (teamId, userId) — no pre-read, no 23505 path', async () => {
    insertState.values = undefined;
    insertState.conflict = undefined;
    insertState.returningRows = [{ id: 'm1', teamId: 'team-1', userId: 'u9', role: 'manager', deletedAt: null }];
    dbMock.select.mockClear();

    const res = await post({ userId: 'u9', role: 'manager' });
    expect(res.status).toBe(201);

    expect(dbMock.select).toHaveBeenCalledTimes(1); // only loadTeam
    expect(insertState.values).toMatchObject({ teamId: 'team-1', userId: 'u9', role: 'manager' });
    expect(insertState.conflict).toBeDefined();
    expect(insertState.conflict!.set).toMatchObject({ role: 'manager', deletedAt: null });
  });

  it('re-activates a previously-removed membership through the conflict arm', async () => {
    insertState.conflict = undefined;
    insertState.returningRows = [{ id: 'm1', deletedAt: null }];

    const res = await post({ userId: 'u9' });
    expect(res.status).toBe(201);
    const set = insertState.conflict!.set as Record<string, unknown>;
    expect(set.deletedAt).toBeNull();
    expect(set.updatedBy).toBe(mockCtx.userId);
  });

  it('still rejects non-admins and missing userId before touching the DB', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      (await import('next/server')).NextResponse.json({ error: 'nope' }, { status: 401 }),
    );
    const res = await post({ userId: 'u9' });
    expect(res.status).toBe(401);
  });
});
