/**
 * Workspace User Defaults
 *   GET   /api/tenant/admin/user-defaults
 *   PATCH /api/tenant/admin/user-defaults
 *   DELETE /api/tenant/admin/user-defaults  — clear all workspace defaults
 *
 * Storage: tenants.settings.user_defaults (jsonb_set merge).
 * Resolution at user level: user prefs > workspace_defaults > hard defaults.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';

const VALID = {
  theme:           ['light', 'dark', 'system'],
  font_size:       ['small', 'normal', 'large', 'xl'],
  ui_density:      ['compact', 'cozy', 'comfy'],
  accent_color:    ['violet', 'indigo', 'blue', 'cyan', 'emerald', 'amber', 'rose', 'slate'],
  sidebar_default: ['expanded', 'collapsed'],
  date_format:     ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'],
  time_format:     ['12h', '24h'],
  week_start:      ['sunday', 'monday'],
  default_landing: [
    '/tenant/dashboard', '/tenant/leads', '/tenant/contacts',
    '/tenant/deals',     '/tenant/tasks', '/tenant/calendar',
    '/tenant/tickets',
  ],
  default_record_view: ['list', 'kanban', 'calendar', 'card'],
  default_page_size:   [10, 25, 50, 100],
  confirm_destructive: ['always', 'danger_only', 'never'],
  default_calendar_view: ['day', 'week', 'month', 'agenda'],
  email_tracking_default: ['on', 'off', 'ask'],
  default_meeting_duration: [15, 30, 45, 60, 90],
  online_status_visible: ['everyone', 'team', 'nobody'],
  activity_visible_to:   ['everyone', 'team', 'managers', 'nobody'],
};

const STRING_VALIDATED = [
  'theme','font_size','ui_density','accent_color','sidebar_default',
  'date_format','time_format','week_start',
  'default_landing','default_record_view','confirm_destructive','default_calendar_view',
  'email_tracking_default','online_status_visible','activity_visible_to',
] as const;
const NUMBER_VALIDATED = ['default_page_size','default_meeting_duration'] as const;
const BOOLEAN_KEYS = [
  'reduce_motion', 'high_contrast', 'show_avatars',
  'links_open_new_tab', 'keyboard_shortcuts_enabled', 'sticky_filters',
  'show_tips', 'autosave_drafts', 'show_keyboard_hints', 'auto_cc_self',
];

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const [t] = await db
      .select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1);

    const stored = (((t?.settings as Record<string, unknown>) ?? {}).user_defaults ?? {}) as Record<string, unknown>;
    return NextResponse.json({ user_defaults: stored });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireAuth>>;
  try {
    ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const incoming = body.user_defaults;
    if (!incoming || typeof incoming !== 'object')
      return NextResponse.json({ error: 'user_defaults object required' }, { status: 400 });

    const safe: Record<string, unknown> = {};

    for (const k of STRING_VALIDATED) {
      if (incoming[k] === undefined || incoming[k] === null) continue;
      const list = (VALID as Record<string, unknown>)[k] as readonly unknown[] | undefined;
      if (list && !list.includes(incoming[k]))
        return NextResponse.json({ error: `${k} must be one of ${list.join(', ')}` }, { status: 400 });
      safe[k] = incoming[k];
    }
    for (const k of NUMBER_VALIDATED) {
      if (incoming[k] === undefined || incoming[k] === null) continue;
      const v = Number(incoming[k]);
      const list = (VALID as Record<string, unknown>)[k] as readonly unknown[] | undefined;
      if (list && !list.includes(v))
        return NextResponse.json({ error: `${k} must be one of ${list.join(', ')}` }, { status: 400 });
      safe[k] = v;
    }
    for (const k of BOOLEAN_KEYS) {
      if (incoming[k] !== undefined && incoming[k] !== null)
        safe[k] = incoming[k] === true;
    }
    if (typeof incoming.locale === 'string') {
      if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(incoming.locale))
        return NextResponse.json({ error: 'locale must be like "en" or "en-US"' }, { status: 400 });
      safe['locale'] = incoming.locale;
    }
    if (typeof incoming.email_signature === 'string') {
      if (incoming.email_signature.length > 5000)
        return NextResponse.json({ error: 'email_signature too long (max 5000)' }, { status: 400 });
      safe['email_signature'] = incoming.email_signature;
    }

    if (Object.keys(safe).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    await db
      .update(tenants)
      .set({
        settings: sql`
          jsonb_set(
            COALESCE(${tenants.settings}, '{}'::jsonb),
            '{user_defaults}',
            COALESCE(${tenants.settings}->'user_defaults', '{}'::jsonb) || ${JSON.stringify(safe)}::jsonb
          )
        `,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, ctx.tenantId));

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'update_user_defaults', entityType: 'tenant',
      newData: { keys: Object.keys(safe) },
    });

    return NextResponse.json({ ok: true, user_defaults: safe });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[user-defaults PATCH]', err);
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    await db
      .update(tenants)
      .set({
        settings: sql`COALESCE(${tenants.settings}, '{}'::jsonb) - 'user_defaults'`,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, ctx.tenantId));

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'reset_user_defaults', entityType: 'tenant',
      newData: {},
    });

    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
