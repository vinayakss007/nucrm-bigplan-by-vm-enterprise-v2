/**
 * User Preferences (top-CRM-grade granular settings)
 * GET   /api/user/preferences   — read all per-user UI prefs (with workspace fallback)
 * PATCH /api/user/preferences   — partial update
 *
 * Storage:
 *   • users.locale, users.theme               (typed columns)
 *   • users.metadata.prefs.{ ... }            (jsonb merge)
 *
 * Resolution order (per field):
 *   1. user.metadata.prefs.<field>
 *   2. tenants.settings.user_defaults.<field>   (workspace admin can set)
 *   3. hard-coded DEFAULTS below
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users, tenants } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';

const VALID = {
  // Appearance
  theme:           ['light', 'dark', 'system'],
  font_size:       ['small', 'normal', 'large', 'xl'],
  ui_density:      ['compact', 'cozy', 'comfy'],
  accent_color:    ['violet', 'indigo', 'blue', 'cyan', 'emerald', 'amber', 'rose', 'slate'],
  sidebar_default: ['expanded', 'collapsed'],

  // Date / time / numbers
  date_format:     ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'],
  time_format:     ['12h', '24h'],
  week_start:      ['sunday', 'monday'],

  // Productivity
  default_landing: [
    '/tenant/dashboard', '/tenant/leads', '/tenant/contacts',
    '/tenant/deals',     '/tenant/tasks', '/tenant/calendar',
    '/tenant/tickets',
  ],
  default_record_view: ['list', 'kanban', 'calendar', 'card'],
  default_page_size:   [10, 25, 50, 100],
  confirm_destructive: ['always', 'danger_only', 'never'],
  default_calendar_view: ['day', 'week', 'month', 'agenda'],

  // Communication
  email_tracking_default: ['on', 'off', 'ask'],
  default_meeting_duration: [15, 30, 45, 60, 90],

  // Privacy
  online_status_visible: ['everyone', 'team', 'nobody'],
  activity_visible_to:   ['everyone', 'team', 'managers', 'nobody'],
};

const DEFAULTS = {
  // Appearance
  locale: 'en',
  theme: 'system',
  font_size: 'normal',
  ui_density: 'cozy',
  accent_color: 'violet',
  sidebar_default: 'expanded',
  reduce_motion: false,
  high_contrast: false,
  show_avatars: true,

  // Date / time / numbers
  date_format: 'MM/DD/YYYY',
  time_format: '12h',
  week_start: 'sunday',

  // Productivity
  default_landing: '/tenant/dashboard',
  default_record_view: 'list',
  default_page_size: 25,
  confirm_destructive: 'always',
  default_calendar_view: 'week',
  links_open_new_tab: false,
  keyboard_shortcuts_enabled: true,
  sticky_filters: true,
  show_tips: true,
  autosave_drafts: true,
  show_keyboard_hints: true,

  // Communication
  email_signature: '',
  email_tracking_default: 'on',
  auto_cc_self: false,
  default_meeting_duration: 30,

  // Privacy
  online_status_visible: 'team',
  activity_visible_to: 'team',

  // Sidebar customization (array of nav-item hrefs to hide)
  hidden_nav_items: [] as string[],
};

const BOOLEAN_KEYS = [
  'reduce_motion', 'high_contrast', 'show_avatars',
  'links_open_new_tab', 'keyboard_shortcuts_enabled', 'sticky_filters',
  'show_tips', 'autosave_drafts', 'show_keyboard_hints', 'auto_cc_self',
];
const STRING_VALIDATED = [
  'theme','font_size','ui_density','accent_color','sidebar_default',
  'date_format','time_format','week_start',
  'default_landing','default_record_view','confirm_destructive','default_calendar_view',
  'email_tracking_default','online_status_visible','activity_visible_to',
] as const;
const NUMBER_VALIDATED = ['default_page_size','default_meeting_duration'] as const;

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const [u] = await db
      .select({ locale: users.locale, theme: users.theme, metadata: users.metadata })
      .from(users).where(eq(users.id, ctx.userId)).limit(1);

    const userPrefs = ((u?.metadata as Record<string, unknown>)?.['prefs'] ?? {}) as Record<string, unknown>;

    // Workspace defaults (admin-set overrides for fields the user hasn't customised)
    const [t] = await db
      .select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1);
    const workspaceDefaults = (((t?.settings as Record<string, unknown>) ?? {})['user_defaults'] ?? {}) as Record<string, unknown>;

    const resolved: Record<string, any> = { ...DEFAULTS, ...workspaceDefaults, ...userPrefs };
    if (u?.locale) resolved['locale'] = u.locale;
    if (u?.theme)  resolved['theme'] = u.theme;

    return NextResponse.json({
      preferences: resolved,
      workspace_defaults: workspaceDefaults,
      has_user_overrides: Object.keys(userPrefs).length > 0,
    });
  } catch (err: any) {
    return apiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const body = await req.json().catch((err) => { console.error('[preferences] JSON parse failed', err); return {}; });

    // Validate strings
    for (const k of STRING_VALIDATED) {
      const list = (VALID as Record<string, unknown>)[k] as string[] | undefined;
      if (body[k] !== undefined && list && !list.includes(body[k]))
        return NextResponse.json({ error: `${k} must be one of ${list.join(', ')}` }, { status: 400 });
    }
    // Validate numbers
    for (const k of NUMBER_VALIDATED) {
      const list = (VALID as Record<string, unknown>)[k] as number[] | undefined;
      if (body[k] !== undefined && list && !list.includes(Number(body[k])))
        return NextResponse.json({ error: `${k} must be one of ${list.join(', ')}` }, { status: 400 });
    }
    // Locale
    if (body.locale !== undefined && !/^[a-z]{2}(-[A-Z]{2})?$/.test(body.locale))
      return NextResponse.json({ error: 'locale must be like "en" or "en-US"' }, { status: 400 });
    // Email signature length
    if (body.email_signature !== undefined && typeof body.email_signature === 'string' && body.email_signature.length > 5000)
      return NextResponse.json({ error: 'email_signature too long (max 5000)' }, { status: 400 });

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.locale === 'string') update['locale'] = body.locale;
    if (typeof body.theme === 'string')  update['theme'] = body.theme;

    // Build the metadata.prefs patch (everything else)
    const patch: Record<string, any> = {};
    for (const k of [...STRING_VALIDATED, ...NUMBER_VALIDATED]) {
      if (body[k] !== undefined) patch[k] = NUMBER_VALIDATED.includes(k as typeof NUMBER_VALIDATED[number]) ? Number(body[k]) : body[k];
    }
    for (const k of BOOLEAN_KEYS) {
      if (body[k] !== undefined) patch[k] = body[k] === true;
    }
    if (typeof body.email_signature === 'string') patch['email_signature'] = body.email_signature;

    // Sidebar customization — array of nav hrefs the user has hidden
    if (Array.isArray(body.hidden_nav_items)) {
      const cleaned = body.hidden_nav_items
        .filter((s: any) => typeof s === 'string' && s.startsWith('/tenant/'))
        .map((s: string) => s.trim().slice(0, 200))
        .slice(0, 200);
      patch['hidden_nav_items'] = cleaned;
    }

    if (Object.keys(patch).length > 0) {
      update['metadata'] = sql`
        jsonb_set(
          COALESCE(${users.metadata}, '{}'::jsonb),
          '{prefs}',
          COALESCE(${users.metadata}->'prefs', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
        )
      `;
    }

    if (Object.keys(update).length <= 1) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    await db.update(users).set(update).where(eq(users.id, ctx.userId));

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return apiError(err);
  }
}

/**
 * DELETE /api/user/preferences
 * Reset all per-user overrides — fall back to workspace defaults.
 */
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    await db.update(users).set({
      metadata: sql`COALESCE(${users.metadata}, '{}'::jsonb) - 'prefs'`,
      updatedAt: new Date(),
    }).where(eq(users.id, ctx.userId));

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return apiError(err);
  }
}
