import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { platformSettings } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';

const ALLOWED = [
  'platform_name', 'support_email', 'app_url', 'allow_signups', 'require_email_verify',
  'maintenance_mode', 'default_trial_days', 'default_plan', 'max_free_tenants',
  'stripe_publishable_key', 'stripe_secret_key', 'stripe_webhook_secret',
  'resend_api_key', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from',
  'default_timezone', 'contact_score_enabled', 'session_duration_days', 'max_sessions_per_user',
  'backup_retention_days', 'backup_bucket', 'ai_features_enabled', 'anthropic_api_key',
];

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const rows = await db
      .select({ key: platformSettings.key, value: platformSettings.value })
      .from(platformSettings)
      .where(isNull(platformSettings.tenantId));

    const defaults: Record<string, string> = {
      platform_name: 'NuCRM',
      support_email: '',
      app_url: process.env.NEXT_PUBLIC_APP_URL ?? '',
      allow_signups: 'true',
      require_email_verify: 'true',
      maintenance_mode: 'false',
      default_trial_days: process.env.DEFAULT_TRIAL_DAYS ?? '14',
      default_plan: 'free',
      max_free_tenants: '1000',
      stripe_publishable_key: '',
      stripe_secret_key: '',
      stripe_webhook_secret: '',
      resend_api_key: '',
      smtp_host: '',
      smtp_port: '587',
      smtp_user: '',
      smtp_pass: '',
      smtp_from: '',
      default_timezone: 'UTC',
      contact_score_enabled: 'true',
      session_duration_days: '30',
      max_sessions_per_user: '10',
      backup_retention_days: '30',
      backup_bucket: process.env.BACKUP_BUCKET ?? '',
      ai_features_enabled: 'false',
      anthropic_api_key: '',
    };

    for (const row of rows) {
      if (typeof row.value === 'string') {
        defaults[row.key] = row.value;
      } else {
        defaults[row.key] = JSON.stringify(row.value);
      }
    }

    return NextResponse.json({ data: defaults });
  } catch (err: any) {
    console.error('[superadmin/settings GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json();

    await db.transaction(async (tx) => {
      for (const [k, v] of Object.entries(body)) {
        if (ALLOWED.includes(k)) {
          await tx
            .insert(platformSettings)
            .values({
              key: k,
              value: String(v),
              tenantId: null,
            })
            .onConflictDoUpdate({
              target: [platformSettings.key, platformSettings.tenantId],
              set: { value: String(v), updatedAt: new Date() },
            });
        }
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[superadmin/settings POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

