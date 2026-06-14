/**
 * Super-Admin: Settings Adoption & Drift metrics
 *   GET /api/superadmin/adoption
 *
 * Aggregates configuration adoption across every active tenant.
 * Read-only. Single round-trip when possible.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

    const today = new Date().toISOString().slice(0, 10);

    // One big query — single round-trip aggregating everything.
    const result = await db.execute(sql`
      SELECT
        (SELECT count(*) FROM tenants WHERE status IN ('active','trialing'))::int AS total_tenants,

        -- adoption: tenants with each settings sub-tree configured (and non-empty)
        (SELECT count(*) FROM tenants WHERE status IN ('active','trialing')
          AND settings ? 'localization'
          AND jsonb_typeof(settings->'localization') = 'object'
          AND settings->'localization' <> '{}'::jsonb)::int AS adoption_localization,
        (SELECT count(*) FROM tenants WHERE status IN ('active','trialing')
          AND settings ? 'login_policy'
          AND jsonb_typeof(settings->'login_policy') = 'object'
          AND settings->'login_policy' <> '{}'::jsonb)::int AS adoption_login_policy,
        (SELECT count(*) FROM tenants WHERE status IN ('active','trialing')
          AND settings ? 'picklists'
          AND jsonb_typeof(settings->'picklists') = 'object'
          AND settings->'picklists' <> '{}'::jsonb)::int AS adoption_picklists,
        (SELECT count(*) FROM tenants WHERE status IN ('active','trialing')
          AND settings ? 'user_defaults'
          AND jsonb_typeof(settings->'user_defaults') = 'object'
          AND settings->'user_defaults' <> '{}'::jsonb)::int AS adoption_user_defaults,

        -- drift signals
        (SELECT count(*) FROM tenants WHERE status IN ('active','trialing')
          AND COALESCE((settings->'login_policy'->'password'->>'min_length')::int, 12) < 12)::int AS weak_password_policy,
        (SELECT count(*) FROM tenants WHERE status IN ('active','trialing')
          AND COALESCE(settings->'login_policy'->'two_factor'->>'enforcement', 'optional') = 'off')::int AS two_factor_off,
        (SELECT count(*) FROM tenants WHERE status IN ('active','trialing')
          AND settings->'login_policy'->'two_factor'->>'enforcement' = 'required')::int AS two_factor_required,
        (SELECT count(*) FROM tenants WHERE status IN ('active','trialing')
          AND COALESCE((settings->'login_policy'->'network'->>'ip_allowlist_enabled')::boolean, false) = true)::int AS ip_allowlist_on,
        (SELECT count(*) FROM tenants WHERE status IN ('active','trialing')
          AND COALESCE((settings->'login_policy'->'login'->>'allow_self_signup')::boolean, false) = true)::int AS self_signup_on,

        -- user-level
        (SELECT count(DISTINCT u.id) FROM users u
          INNER JOIN tenant_members tm ON tm.user_id = u.id AND tm.status = 'active')::int AS users_total,
        (SELECT count(DISTINCT u.id) FROM users u
          INNER JOIN tenant_members tm ON tm.user_id = u.id AND tm.status = 'active'
          WHERE u.metadata ? 'prefs' AND jsonb_typeof(u.metadata->'prefs') = 'object'
            AND u.metadata->'prefs' <> '{}'::jsonb)::int AS users_with_prefs,

        -- out-of-office: members away today
        (SELECT count(*) FROM tenant_members
          WHERE status = 'active'
            AND COALESCE((settings->'out_of_office'->>'enabled')::boolean, false) = true
            AND COALESCE(settings->'out_of_office'->>'start_date', '9999-01-01') <= ${today}
            AND COALESCE(settings->'out_of_office'->>'end_date',   '0001-01-01') >= ${today})::int AS users_ooo
    `);

    const row = (result.rows?.[0] ?? {}) as Record<string, unknown>;

    return NextResponse.json({
      total_tenants: Number(row['total_tenants']) || 0,
      adoption: {
        localization:  Number(row['adoption_localization'])  || 0,
        login_policy:  Number(row['adoption_login_policy'])  || 0,
        picklists:     Number(row['adoption_picklists'])     || 0,
        user_defaults: Number(row['adoption_user_defaults']) || 0,
      },
      drift: {
        weak_password_policy: Number(row['weak_password_policy']) || 0,
        two_factor_off:       Number(row['two_factor_off'])       || 0,
        two_factor_required:  Number(row['two_factor_required'])  || 0,
        ip_allowlist_on:      Number(row['ip_allowlist_on'])      || 0,
        self_signup_on:       Number(row['self_signup_on'])       || 0,
      },
      users: {
        total:             Number(row['users_total'])      || 0,
        with_prefs:        Number(row['users_with_prefs']) || 0,
        out_of_office_now: Number(row['users_ooo'])        || 0,
      },
    });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[superadmin adoption]', err);
    return apiError(err);
  }
}
