/**
 * Workspace Localization
 *   GET   /api/tenant/admin/localization
 *   PATCH /api/tenant/admin/localization
 *
 * Storage: tenants.settings.localization  (jsonb_set merge — never clobbers other keys)
 * Shape:
 *   {
 *     timezone:        IANA tz id,
 *     currency:        ISO 4217,
 *     fiscal_year_start_month: 1..12,
 *     week_start:      'sunday' | 'monday' | 'saturday',
 *     weekend_days:    array of weekday lower-case names,
 *     business_hours:  { enabled, start_time, end_time, working_days[] },
 *     holidays:        [ { date: 'YYYY-MM-DD', name: string } ],
 *     number_format:   '1,234.56' | '1.234,56' | '1 234,56'
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';

const VALID = {
  week_start:    ['sunday', 'monday', 'saturday'],
  weekend_days:  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
  number_format: ['1,234.56', '1.234,56', '1 234,56'],
};

const DEFAULTS = {
  timezone: 'UTC',
  currency: 'USD',
  fiscal_year_start_month: 1,
  week_start: 'sunday',
  weekend_days: ['saturday', 'sunday'],
  business_hours: {
    enabled: false,
    start_time: '09:00',
    end_time: '17:00',
    working_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  },
  holidays: [] as Array<{ date: string; name: string }>,
  number_format: '1,234.56',
};

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const [t] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);

    const stored = ((t?.settings as any) ?? {}).localization ?? {};
    return NextResponse.json({ localization: { ...DEFAULTS, ...stored } });
  } catch (err: any) {
    return apiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  let ctx: any;
  try {
    ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const body = await req.json().catch(e => { console.error('[json] parse error:', e); return {}; });
    const incoming = body.localization;
    if (!incoming || typeof incoming !== 'object')
      return NextResponse.json({ error: 'localization object required' }, { status: 400 });

    // Validate
    if (incoming.fiscal_year_start_month !== undefined) {
      const m = Number(incoming.fiscal_year_start_month);
      if (!Number.isInteger(m) || m < 1 || m > 12)
        return NextResponse.json({ error: 'fiscal_year_start_month must be 1-12' }, { status: 400 });
    }
    if (incoming.week_start && !VALID.week_start.includes(incoming.week_start))
      return NextResponse.json({ error: `week_start must be one of ${VALID.week_start.join(', ')}` }, { status: 400 });
    if (incoming.weekend_days && (!Array.isArray(incoming.weekend_days) ||
        incoming.weekend_days.some((d: any) => !VALID.weekend_days.includes(d))))
      return NextResponse.json({ error: 'weekend_days must be a subset of weekday names' }, { status: 400 });
    if (incoming.number_format && !VALID.number_format.includes(incoming.number_format))
      return NextResponse.json({ error: 'number_format invalid' }, { status: 400 });
    if (incoming.timezone && typeof incoming.timezone !== 'string')
      return NextResponse.json({ error: 'timezone must be a string' }, { status: 400 });
    if (incoming.currency && !/^[A-Z]{3}$/.test(incoming.currency))
      return NextResponse.json({ error: 'currency must be a 3-letter ISO code' }, { status: 400 });

    const bh = incoming.business_hours;
    if (bh) {
      if (typeof bh !== 'object') return NextResponse.json({ error: 'business_hours must be an object' }, { status: 400 });
      if (bh.start_time && !/^\d{2}:\d{2}$/.test(bh.start_time))
        return NextResponse.json({ error: 'business_hours.start_time must be HH:MM' }, { status: 400 });
      if (bh.end_time && !/^\d{2}:\d{2}$/.test(bh.end_time))
        return NextResponse.json({ error: 'business_hours.end_time must be HH:MM' }, { status: 400 });
      if (bh.working_days && (!Array.isArray(bh.working_days) ||
          bh.working_days.some((d: any) => !VALID.weekend_days.includes(d))))
        return NextResponse.json({ error: 'business_hours.working_days invalid' }, { status: 400 });
    }

    const holidays = incoming.holidays;
    if (holidays !== undefined) {
      if (!Array.isArray(holidays))
        return NextResponse.json({ error: 'holidays must be an array' }, { status: 400 });
      for (const h of holidays) {
        if (!h || typeof h !== 'object') return NextResponse.json({ error: 'each holiday must be an object' }, { status: 400 });
        if (!h.date || !/^\d{4}-\d{2}-\d{2}$/.test(h.date))
          return NextResponse.json({ error: 'holiday.date must be YYYY-MM-DD' }, { status: 400 });
        if (!h.name || typeof h.name !== 'string' || h.name.trim().length === 0)
          return NextResponse.json({ error: 'holiday.name required' }, { status: 400 });
        if (h.name.length > 200)
          return NextResponse.json({ error: 'holiday.name too long' }, { status: 400 });
      }
      if (holidays.length > 200)
        return NextResponse.json({ error: 'max 200 holidays' }, { status: 400 });
    }

    const safe: any = {};
    if (incoming.timezone !== undefined) safe.timezone = String(incoming.timezone).slice(0, 100);
    if (incoming.currency !== undefined) safe.currency = String(incoming.currency).toUpperCase();
    if (incoming.fiscal_year_start_month !== undefined) safe.fiscal_year_start_month = Number(incoming.fiscal_year_start_month);
    if (incoming.week_start !== undefined) safe.week_start = incoming.week_start;
    if (incoming.weekend_days !== undefined) safe.weekend_days = incoming.weekend_days;
    if (incoming.number_format !== undefined) safe.number_format = incoming.number_format;
    if (bh !== undefined) {
      safe.business_hours = {
        enabled: bh.enabled === true,
        start_time: bh.start_time ?? DEFAULTS.business_hours.start_time,
        end_time: bh.end_time ?? DEFAULTS.business_hours.end_time,
        working_days: Array.isArray(bh.working_days) ? bh.working_days : DEFAULTS.business_hours.working_days,
      };
    }
    if (holidays !== undefined) {
      safe.holidays = (holidays as any[]).map(h => ({ date: h.date, name: String(h.name).trim().slice(0, 200) }));
    }

    // Merge into tenants.settings.localization without touching siblings
    await db
      .update(tenants)
      .set({
        settings: sql`
          jsonb_set(
            COALESCE(${tenants.settings}, '{}'::jsonb),
            '{localization}',
            COALESCE(${tenants.settings}->'localization', '{}'::jsonb) || ${JSON.stringify(safe)}::jsonb
          )
        `,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, ctx.tenantId));

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'update_localization', entityType: 'tenant',
      newData: safe,
    });

    return NextResponse.json({ ok: true, localization: { ...DEFAULTS, ...safe } });
  } catch (err: any) {
    console.error('[localization PATCH]', err);
    return apiError(err);
  }
}
