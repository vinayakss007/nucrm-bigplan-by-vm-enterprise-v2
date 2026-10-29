/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3280 — "is bootstrap done?" asked in a way that cannot be misread.
 *
 * The alternative an operator had was a shell:
 *
 *   psql "$DATABASE_URL" -At -c 'select count(*) from users where is_super_admin'   # → 0
 *
 * and that `0` is true and useless at once. `DATABASE_URL` is the application role: not the
 * table owner, not a superuser, no `BYPASSRLS`, so Row Level Security binds it on `users`,
 * where no SELECT policy admits a row to a session declaring neither `app.current_user` nor
 * `app.is_super_admin` (0088). The rows are there; the session is simply not entitled to see
 * them, and nothing says so. "0 rows visible" and "no rows exist" arrive as the same integer,
 * which is how a zero becomes a confident, wrong "fresh install — safe to rebuild".
 *
 * So this endpoint does the one thing the shell cannot: it counts inside the same security
 * context `POST /api/setup/create-admin` uses for its own "only one super admin" guard
 * (`withSecurityContext`, i.e. a transaction carrying `SET LOCAL app.is_super_admin`), so the
 * answer it gives is the answer that guard acts on. Two integers, no PII.
 *
 * Deliberately a SEPARATE route from `/api/setup/check`, not a replacement: `check` answers
 * one boolean and is pinned by `tests/unit/setup-check-route.test.ts` and by
 * `scripts/preprod-api-e2e.ts` A1/A4, and widening its payload would change a surface the
 * preprod drill depends on. `status` is the superset, so `check` may delegate to it later;
 * that is a follow-up, not this PR. Both keep their own rate-limit bucket for the reason
 * `guard:public-ratelimit` gives — a shared action is a shared budget.
 *
 * Discipline inherited from `check`: throttled before any database work (#1154), and a
 * failure is a 503 rather than `super_admin_exists: false` (#1151) — a refused read is not
 * evidence of an empty database, and the false is the answer that invites a destructive act.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { withSecurityContext } from '@/lib/db/rls';
import { users, tenants } from '@/drizzle/schema';
import { eq, count } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';

// Public endpoint — reports whether platform bootstrap has happened yet, in counts only.
export async function GET(request: NextRequest) {
  // #1154: unauthenticated surface, so throttle before touching the pool.
  const limited = await checkRateLimit(request, { action: 'setup-status', max: 10, windowMinutes: 1 });
  if (limited) return limited;

  try {
    // One transaction, one context, both numbers — the shape that makes them comparable.
    // Under FORCE RLS a read of `users` taken on the pool (which `lib/db/pool.ts` clears of
    // every `app.*` GUC on acquire AND release) answers zero for a platform that already has
    // its super admin, so neither count is allowed to leave this callback unprivileged.
    const [admins, workspaces] = await withSecurityContext(async (tx) => {
      const [adminRow] = await tx
        .select({ count: count() })
        .from(users)
        .where(eq(users.isSuperAdmin, true));
      // `tenants` is this product's workspace (`create-admin` writes the workspace's name
      // into it), and 0054 gave it `tenants_read_all … USING (true)` — it is honest from any
      // session. It is still read here, so the two integers describe the same instant.
      const [workspaceRow] = await tx.select({ count: count() }).from(tenants);
      return [adminRow?.count ?? 0, workspaceRow?.count ?? 0] as const;
    });

    return NextResponse.json({
      super_admin_exists: admins > 0,
      workspace_count: workspaces,
    });
  } catch (err) {
    // #1151: on a DB error the install state is unknown, not absent. Answering
    // `super_admin_exists: false` here would be the exact #3280 failure — a zero
    // presented as an absence, one scroll away from `npm run db:reset`.
    void logError({ error: err, context: 'setup/status' });
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }
}
