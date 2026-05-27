/**
 * User Preferences
 * GET   /api/user/preferences   — read all per-user UI prefs
 * PATCH /api/user/preferences   — partial update
 *
 * Storage:
 *   • users.locale, users.theme               (typed columns)
 *   • users.metadata.prefs.{ ui_density,
 *       date_format, time_format, week_start,
 *       default_landing }                      (jsonb merge)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';

const VALID = {
  theme:           ['light', 'dark', 'system'],
  ui_density:      ['compact', 'cozy', 'comfy'],
  date_format:     ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'],
  time_format:     ['12h', '24h'],
  week_start:      ['sunday', 'monday'],
  default_landing: [
    '/tenant/dashboard',
    '/tenant/leads',
    '/tenant/contacts',
    '/tenant/deals',
    '/tenant/tasks',
    '/tenant/calendar',
  ],
};

const DEFAULTS = {
  locale: 'en',
  theme: 'system',
  ui_density: 'cozy',
  date_format: 'MM/DD/YYYY',
  time_format: '12h',
  week_start: 'sunday',
  default_landing: '/tenant/dashboard',
};

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const [u] = await db
      .select({ locale: users.locale, theme: users.theme, metadata: users.metadata })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);

    const prefs = (u?.metadata as any)?.prefs ?? {};
    return NextResponse.json({
      preferences: {
        locale:          u?.locale ?? DEFAULTS.locale,
        theme:           u?.theme ?? DEFAULTS.theme,
        ui_density:      prefs.ui_density ?? DEFAULTS.ui_density,
        date_format:     prefs.date_format ?? DEFAULTS.date_format,
        time_format:     prefs.time_format ?? DEFAULTS.time_format,
        week_start:      prefs.week_start ?? DEFAULTS.week_start,
        default_landing: prefs.default_landing ?? DEFAULTS.default_landing,
      },
    });
  } catch (err: any) {
    return apiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const body = await req.json().catch(() => ({}));

    // Validate
    if (body.theme && !VALID.theme.includes(body.theme))
      return NextResponse.json({ error: `theme must be one of ${VALID.theme.join(', ')}` }, { status: 400 });
    if (body.ui_density && !VALID.ui_density.includes(body.ui_density))
      return NextResponse.json({ error: `ui_density must be one of ${VALID.ui_density.join(', ')}` }, { status: 400 });
    if (body.date_format && !VALID.date_format.includes(body.date_format))
      return NextResponse.json({ error: `date_format must be one of ${VALID.date_format.join(', ')}` }, { status: 400 });
    if (body.time_format && !VALID.time_format.includes(body.time_format))
      return NextResponse.json({ error: `time_format must be one of ${VALID.time_format.join(', ')}` }, { status: 400 });
    if (body.week_start && !VALID.week_start.includes(body.week_start))
      return NextResponse.json({ error: `week_start must be one of ${VALID.week_start.join(', ')}` }, { status: 400 });
    if (body.default_landing && !VALID.default_landing.includes(body.default_landing))
      return NextResponse.json({ error: 'default_landing is not a valid path' }, { status: 400 });
    if (body.locale && !/^[a-z]{2}(-[A-Z]{2})?$/.test(body.locale))
      return NextResponse.json({ error: 'locale must be like "en" or "en-US"' }, { status: 400 });

    const update: any = { updatedAt: new Date() };
    if (typeof body.locale === 'string') update.locale = body.locale;
    if (typeof body.theme === 'string')  update.theme = body.theme;

    // Merge jsonb prefs into users.metadata.prefs
    const jsonbKeys = ['ui_density', 'date_format', 'time_format', 'week_start', 'default_landing'];
    const patch: Record<string, any> = {};
    for (const k of jsonbKeys) if (typeof body[k] === 'string') patch[k] = body[k];
    if (Object.keys(patch).length > 0) {
      update.metadata = sql`
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
