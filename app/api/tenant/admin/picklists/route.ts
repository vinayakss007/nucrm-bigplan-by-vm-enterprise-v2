/**
 * Picklists (admin only)
 *
 *   GET   /api/tenant/admin/picklists
 *   PATCH /api/tenant/admin/picklists
 *
 * Storage: tenants.settings.picklists  (jsonb_set merge — never clobbers other keys)
 *
 * Categories:
 *   - lead_sources
 *   - loss_reasons
 *   - win_reasons
 *   - activity_types
 *   - deal_types
 *   - industries
 *
 * Each entry: { value: string (slug, max 60), label: string (max 80), color?: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';

export type PicklistEntry = { value: string; label: string; color?: string };
export type PicklistCategory = 'lead_sources' | 'loss_reasons' | 'win_reasons' | 'activity_types' | 'deal_types' | 'industries';

const CATEGORIES: PicklistCategory[] = ['lead_sources','loss_reasons','win_reasons','activity_types','deal_types','industries'];

const DEFAULTS: Record<PicklistCategory, PicklistEntry[]> = {
  lead_sources: [
    { value: 'website',        label: 'Website' },
    { value: 'referral',       label: 'Referral' },
    { value: 'cold_outreach',  label: 'Cold Outreach' },
    { value: 'social_media',   label: 'Social Media' },
    { value: 'event',          label: 'Event' },
    { value: 'inbound',        label: 'Inbound' },
    { value: 'advertisement',  label: 'Advertisement' },
    { value: 'other',          label: 'Other' },
  ],
  loss_reasons: [
    { value: 'price',         label: 'Price too high' },
    { value: 'competitor',    label: 'Lost to competitor' },
    { value: 'no_budget',     label: 'No budget' },
    { value: 'no_timeline',   label: 'No timeline' },
    { value: 'no_response',   label: 'No response' },
    { value: 'feature_gap',   label: 'Feature gap' },
    { value: 'other',         label: 'Other' },
  ],
  win_reasons: [
    { value: 'product_fit',   label: 'Product fit' },
    { value: 'price',         label: 'Best price' },
    { value: 'support',       label: 'Strong support' },
    { value: 'reference',     label: 'Reference customer' },
    { value: 'integration',   label: 'Integration capability' },
    { value: 'other',         label: 'Other' },
  ],
  activity_types: [
    { value: 'call',     label: 'Call' },
    { value: 'email',    label: 'Email' },
    { value: 'meeting',  label: 'Meeting' },
    { value: 'note',     label: 'Note' },
    { value: 'demo',     label: 'Demo' },
    { value: 'task',     label: 'Task' },
  ],
  deal_types: [
    { value: 'new_business',   label: 'New Business' },
    { value: 'expansion',      label: 'Expansion' },
    { value: 'renewal',        label: 'Renewal' },
    { value: 'upsell',         label: 'Upsell' },
  ],
  industries: [
    { value: 'technology',     label: 'Technology' },
    { value: 'healthcare',     label: 'Healthcare' },
    { value: 'finance',        label: 'Finance' },
    { value: 'retail',         label: 'Retail' },
    { value: 'manufacturing',  label: 'Manufacturing' },
    { value: 'education',      label: 'Education' },
    { value: 'real_estate',    label: 'Real Estate' },
    { value: 'other',          label: 'Other' },
  ],
};

const VALUE_RE = /^[a-z0-9_]{1,60}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function normalize(v: string) {
  return v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1);
    const stored = ((t?.settings as any) ?? {}).picklists ?? {};

    const result: Record<PicklistCategory, PicklistEntry[]> = { ...DEFAULTS };
    for (const cat of CATEGORIES) {
      if (Array.isArray(stored[cat])) result[cat] = stored[cat];
    }
    return NextResponse.json({ picklists: result, categories: CATEGORIES });
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
    const incoming = body.picklists;
    if (!incoming || typeof incoming !== 'object')
      return NextResponse.json({ error: 'picklists object required' }, { status: 400 });

    const safe: Partial<Record<PicklistCategory, PicklistEntry[]>> = {};

    for (const cat of CATEGORIES) {
      if (incoming[cat] === undefined) continue;
      if (!Array.isArray(incoming[cat]))
        return NextResponse.json({ error: `${cat} must be an array` }, { status: 400 });
      if (incoming[cat].length > 100)
        return NextResponse.json({ error: `${cat}: max 100 entries` }, { status: 400 });

      const seen = new Set<string>();
      const cleaned: PicklistEntry[] = [];
      for (const raw of incoming[cat]) {
        if (!raw || typeof raw !== 'object') continue;
        const value = String(raw.value ?? '').trim();
        const label = String(raw.label ?? '').trim();
        if (!value || !label)
          return NextResponse.json({ error: `${cat}: value and label required` }, { status: 400 });
        const v = normalize(value);
        if (!VALUE_RE.test(v))
          return NextResponse.json({ error: `${cat}: invalid value "${value}"` }, { status: 400 });
        if (label.length > 80)
          return NextResponse.json({ error: `${cat}: label too long` }, { status: 400 });
        if (seen.has(v))
          return NextResponse.json({ error: `${cat}: duplicate value "${v}"` }, { status: 400 });
        seen.add(v);

        const entry: PicklistEntry = { value: v, label };
        if (raw.color && typeof raw.color === 'string') {
          if (!COLOR_RE.test(raw.color))
            return NextResponse.json({ error: `${cat}: color must be #RRGGBB` }, { status: 400 });
          entry.color = raw.color;
        }
        cleaned.push(entry);
      }
      safe[cat] = cleaned;
    }

    if (Object.keys(safe).length === 0)
      return NextResponse.json({ error: 'No categories provided' }, { status: 400 });

    await db
      .update(tenants)
      .set({
        settings: sql`
          jsonb_set(
            COALESCE(${tenants.settings}, '{}'::jsonb),
            '{picklists}',
            COALESCE(${tenants.settings}->'picklists', '{}'::jsonb) || ${JSON.stringify(safe)}::jsonb
          )
        `,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, ctx.tenantId));

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'update_picklists', entityType: 'tenant',
      newData: { categories: Object.keys(safe) },
    });

    return NextResponse.json({ ok: true, picklists: safe });
  } catch (err: any) {
    console.error('[picklists PATCH]', err);
    return apiError(err);
  }
}
