/**
 * Per-tenant + per-user configuration status.
 * GET /api/tenant/settings-status
 *
 * Returns which settings are configured / default / need-attention. Drives
 * the status badges on the redesigned settings index landing page.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, users, tenantMembers } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';

type StatusValue = 'configured' | 'default' | 'attention' | 'unknown';
type StatusEntry = { status: StatusValue; hint?: string };

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const [t] = await db
      .select({ settings: tenants.settings, name: tenants.name })
      .from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1);

    const [u] = await db
      .select({
        metadata: users.metadata,
        totpEnabled: users.totpEnabled,
        emailVerified: users.emailVerified,
      })
      .from(users).where(eq(users.id, ctx.userId)).limit(1);

    const [m] = await db
      .select({ settings: tenantMembers.settings, notificationPrefs: tenantMembers.notificationPrefs })
      .from(tenantMembers)
      .where(and(
        eq(tenantMembers.tenantId, ctx.tenantId),
        eq(tenantMembers.userId, ctx.userId),
        eq(tenantMembers.status, 'active'),
      ))
      .limit(1);

    const tSettings = (t?.settings ?? {}) as Record<string, unknown>;
    const uPrefs = ((u?.metadata ?? {}) as Record<string, unknown>).prefs ?? {};
    const mSettings = (m?.settings ?? {}) as Record<string, unknown>;
    const mNotif = (m?.notificationPrefs ?? {}) as Record<string, unknown>;

    const has = (obj: unknown) => obj !== null && typeof obj === 'object' && Object.keys(obj as Record<string, unknown>).length > 0;
    const lp = tSettings.login_policy ?? {};

    // Derive a status per route. Pages we don't measure return 'unknown'.
    const statuses: Record<string, StatusEntry> = {};

    // ── Personal ──
    statuses['/tenant/settings/profile']      = { status: u?.emailVerified ? 'configured' : 'attention',
                                                  hint: u?.emailVerified ? 'Email verified' : 'Verify your email' };
    statuses['/tenant/settings/preferences']  = has(uPrefs) ? { status: 'configured', hint: 'Custom prefs set' } : { status: 'default', hint: 'Using defaults' };
    statuses['/tenant/settings/security']     = u?.totpEnabled ? { status: 'configured', hint: '2FA enabled' } : { status: 'attention', hint: '2FA not enabled' };
    statuses['/tenant/settings/notifications'] = has(mNotif?.['matrix']) ? { status: 'configured', hint: 'Customised' } : { status: 'default' };
    statuses['/tenant/settings/out-of-office'] = ((mSettings?.['out_of_office'] as Record<string, boolean>)?.['enabled']) ? { status: 'attention', hint: 'Currently away' } : { status: 'default' };
    statuses['/tenant/settings/sessions']     = { status: 'unknown' };
    statuses['/tenant/settings/telegram']     = { status: 'unknown' };

    // ── Workspace ──
    statuses['/tenant/settings/general']        = { status: 'configured' };
    statuses['/tenant/settings/branding']       = { status: 'unknown' };
    statuses['/tenant/settings/localization']   = has(tSettings['localization'] as Record<string, unknown>) ? { status: 'configured' } : { status: 'default' };
    statuses['/tenant/settings/user-defaults']  = has(tSettings['user_defaults'] as Record<string, unknown>) ? { status: 'configured', hint: `${Object.keys(tSettings['user_defaults'] as Record<string, unknown>).length} defaults set` } : { status: 'default' };
    statuses['/tenant/settings/picklists']      = has(tSettings['picklists'] as Record<string, unknown>) ? { status: 'configured' } : { status: 'default' };
    statuses['/tenant/settings/tags-manager']   = { status: 'unknown' };
    statuses['/tenant/settings/currency']       = (tSettings['localization'] as Record<string, unknown>)?.['currency'] ? { status: 'configured' } : { status: 'default' };
    statuses['/tenant/settings/tax']            = { status: 'unknown' };
    statuses['/tenant/settings/pipelines']      = { status: 'unknown' };
    statuses['/tenant/settings/custom-fields']  = { status: 'unknown' };
    statuses['/tenant/settings/industry-templates'] = { status: 'unknown' };
    statuses['/tenant/settings/team']           = { status: 'unknown' };
    statuses['/tenant/settings/hierarchy']      = { status: 'unknown' };
    statuses['/tenant/settings/territories']    = { status: 'unknown' };
    statuses['/tenant/settings/assignment-rules'] = { status: 'unknown' };
    statuses['/tenant/settings/sla']            = { status: 'unknown' };
    statuses['/tenant/settings/portal']         = { status: 'unknown' };
    statuses['/tenant/settings/email']          = { status: 'unknown' };

    // ── Admin ──
    if (ctx.isAdmin) {
      statuses['/tenant/settings/admin']        = { status: 'configured' };
      statuses['/tenant/settings/billing']      = { status: 'configured' };

      // Login policy — derive from password / 2fa / IP / signup flags
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lpRec = (lp ?? {}) as Record<string, any>;
      const minLen = Number((lpRec['password'] as Record<string, unknown>)?.['min_length'] ?? 12);
      const tfa = (lpRec['two_factor'] as Record<string, unknown>)?.['enforcement'] ?? 'optional';
      const ipOn = (lpRec['network'] as Record<string, unknown>)?.['ip_allowlist_enabled'] === true;
      const signup = (lpRec['login'] as Record<string, unknown>)?.['allow_self_signup'] === true;
      const concerns: string[] = [];
      if (minLen < 12) concerns.push(`pwd min ${minLen}`);
      if (tfa === 'off') concerns.push('2FA off');
      if (signup) concerns.push('self-signup on');
      statuses['/tenant/settings/login-policy'] = has(lp)
        ? (concerns.length > 0
            ? { status: 'attention', hint: concerns.join(', ') }
            : { status: 'configured', hint: ipOn ? 'IP allowlist on' : '2FA ' + tfa })
        : { status: 'attention', hint: 'Using platform defaults' };

      statuses['/tenant/settings/roles']        = { status: 'unknown' };
      statuses['/tenant/settings/rbac']         = { status: 'unknown' };
      statuses['/tenant/settings/sso']          = { status: 'unknown' };
      statuses['/tenant/settings/api-keys']     = { status: 'unknown' };
      statuses['/tenant/settings/bulk-transfer'] = { status: 'default' };
      statuses['/tenant/settings/import-export'] = { status: 'unknown' };
      statuses['/tenant/settings/backup']       = { status: 'unknown' };
      statuses['/tenant/settings/audit']        = { status: 'configured' };
      statuses['/tenant/settings/compliance']   = { status: 'unknown' };
      statuses['/tenant/settings/integrations'] = { status: 'unknown' };
      statuses['/tenant/settings/webhooks']     = { status: 'unknown' };
    }

    // ── Health summary (counts per status) ──
    const summary = { configured: 0, default: 0, attention: 0, unknown: 0 };
    for (const v of Object.values(statuses)) summary[v.status]++;

    return NextResponse.json({ statuses, summary });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
