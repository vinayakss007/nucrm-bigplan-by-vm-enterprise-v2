/**
 * User Notification Matrix
 *   GET   /api/tenant/notifications/matrix
 *   PATCH /api/tenant/notifications/matrix
 *
 * Storage: tenant_members.notification_prefs ->> 'matrix'  (jsonb)
 * Shape:
 *   { matrix: { "<event_key>": { in_app:bool, email:bool, telegram:bool } } }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenantMembers } from '@/drizzle/schema';
import { and, eq, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';

const CHANNELS = ['in_app', 'email', 'telegram'] as const;
type Channel = typeof CHANNELS[number];

// Event taxonomy — keep in sync with the page UI.
const EVENT_KEYS = new Set([
  // Leads
  'lead.created', 'lead.assigned_to_me', 'lead.status_changed',
  // Contacts
  'contact.created', 'contact.mentioned_me',
  // Deals
  'deal.created', 'deal.assigned_to_me', 'deal.stage_changed',
  'deal.won', 'deal.lost', 'deal.close_date_approaching',
  // Tasks
  'task.assigned_to_me', 'task.due_today', 'task.overdue',
  // Tickets
  'ticket.created', 'ticket.assigned_to_me', 'ticket.replied',
  // Comments / collaboration
  'comment.mentioned_me', 'comment.replied',
  // Team
  'team.invite_accepted', 'team.role_changed',
  // Security
  'security.login_new_device', 'security.password_changed', 'security.two_factor_changed',
  // Billing
  'billing.trial_ending', 'billing.payment_failed', 'billing.plan_changed',
]);

const DEFAULTS: Record<string, Record<Channel, boolean>> = Object.fromEntries(
  Array.from(EVENT_KEYS).map(key => {
    // sensible default: in_app=on for everything; email=on for personal alerts; telegram=off
    const personal = /assigned_to_me|mentioned_me|due_today|overdue|replied|won|lost|approaching/.test(key);
    const security = key.startsWith('security.');
    const billing  = key.startsWith('billing.');
    return [key, {
      in_app:   true,
      email:    personal || security || billing,
      telegram: false,
    }];
  })
) as any;

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const row = await db.query.tenantMembers.findFirst({
      where: and(
        eq(tenantMembers.userId, ctx.userId),
        eq(tenantMembers.tenantId, ctx.tenantId),
        eq(tenantMembers.status, 'active')
      ),
      columns: { notificationPrefs: true },
    });

    const stored = ((row?.notificationPrefs as any) ?? {}).matrix ?? {};

    // Merge defaults <- stored, restricted to known keys
    const matrix: Record<string, Record<Channel, boolean>> = {};
    for (const key of EVENT_KEYS) {
      const def = DEFAULTS[key]!;
      const cur = stored[key] ?? {};
      matrix[key] = {
        in_app:   typeof cur.in_app   === 'boolean' ? cur.in_app   : def.in_app,
        email:    typeof cur.email    === 'boolean' ? cur.email    : def.email,
        telegram: typeof cur.telegram === 'boolean' ? cur.telegram : def.telegram,
      };
    }

    return NextResponse.json({ matrix, channels: CHANNELS });
  } catch (err: any) {
    return apiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const body = await req.json().catch(e => { console.error('[json] parse error:', e); return {}; });
    const incoming = body.matrix;
    if (!incoming || typeof incoming !== 'object')
      return NextResponse.json({ error: 'matrix object required' }, { status: 400 });

    // Sanitize — only keep known events / channels / booleans
    const safe: Record<string, Record<Channel, boolean>> = {};
    for (const [key, value] of Object.entries(incoming)) {
      if (!EVENT_KEYS.has(key)) continue;
      if (!value || typeof value !== 'object') continue;
      const v = value as any;
      safe[key] = {
        in_app:   v.in_app   === true,
        email:    v.email    === true,
        telegram: v.telegram === true,
      };
    }

    await db
      .update(tenantMembers)
      .set({
        notificationPrefs: sql`
          jsonb_set(
            COALESCE(${tenantMembers.notificationPrefs}, '{}'::jsonb),
            '{matrix}',
            ${JSON.stringify(safe)}::jsonb
          )
        `,
        updatedAt: new Date(),
      })
      .where(and(
        eq(tenantMembers.userId, ctx.userId),
        eq(tenantMembers.tenantId, ctx.tenantId),
        eq(tenantMembers.status, 'active')
      ));

    return NextResponse.json({ ok: true, count: Object.keys(safe).length });
  } catch (err: any) {
    return apiError(err);
  }
}
