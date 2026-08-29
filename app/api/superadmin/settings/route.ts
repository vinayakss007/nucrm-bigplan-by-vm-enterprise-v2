/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
// SECURITY NOTE: Secrets should be migrated to environment variables. See issue #757 item 41.
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { platformSettingsSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { platformSettings } from '@/drizzle/schema';
import { isNull } from 'drizzle-orm';
import { logSuperAdminAction } from '@/lib/audit/super-admin';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

const ALLOWED = [
  'platform_name', 'support_email', 'app_url', 'allow_signups', 'require_email_verify',
  'maintenance_mode', 'default_trial_days', 'default_plan', 'max_free_tenants',
  'stripe_publishable_key', 'stripe_secret_key', 'stripe_webhook_secret',
  'resend_api_key', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from',
  'default_timezone', 'contact_score_enabled', 'session_duration_days', 'max_sessions_per_user',
  'backup_retention_days', 'backup_bucket', 'ai_features_enabled', 'anthropic_api_key',
];

/** Keys whose values must come from environment variables, never stored in DB */
const ENV_SECRET_MAP: Record<string, string> = {
  stripe_secret_key: 'STRIPE_SECRET_KEY',
  stripe_webhook_secret: 'STRIPE_WEBHOOK_SECRET',
  resend_api_key: 'RESEND_API_KEY',
  smtp_pass: 'SMTP_PASS',
  anthropic_api_key: 'ANTHROPIC_API_KEY',
};

/** Pattern that identifies setting keys containing secrets */
const SECRET_KEY_PATTERN = /secret|key|pass|token/i;

/** Redact a secret value, showing only the last 4 characters prefixed with "****" */
function redactSecret(value: string): string {
  if (!value || value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

/** Returns true if a setting key name refers to a secret value */
function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export const GET = withApiRoute(async (request: NextRequest) => {
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
      // Skip secrets stored in DB — they must come from env vars
      if (row.key in ENV_SECRET_MAP) continue;
      if (typeof row.value === 'string') {
        defaults[row.key] = row.value;
      } else {
        defaults[row.key] = JSON.stringify(row.value);
      }
    }

    // Override secret values from environment variables
    for (const [settingKey, envVar] of Object.entries(ENV_SECRET_MAP)) {
      const envVal = process.env[envVar];
      if (envVal) {
        defaults[settingKey] = envVal;
      }
    }

    // Redact secret values before returning to the client
    const redacted: Record<string, string> = {};
    for (const [key, value] of Object.entries(defaults)) {
      redacted[key] = isSecretKey(key) && value ? redactSecret(value) : value;
    }

    return NextResponse.json({ data: redacted });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'superadmin/settings GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const rawBody = await readJsonBody(request);
    const validated = validateBody(platformSettingsSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const updatedKeys = Object.keys(v).filter((k) => !(k in ENV_SECRET_MAP));

    if (updatedKeys.length === 0) {
      return NextResponse.json({ ok: true, warning: 'Secrets cannot be stored in the database. Set them via environment variables instead.' });
    }

    await db.transaction(async (tx) => {
      for (const k of updatedKeys) {
        const val = v[k];
        if (ALLOWED.includes(k)) {
          await tx
            .insert(platformSettings)
            .values({
              key: k,
              value: String(val),
              tenantId: null,
            })
            .onConflictDoUpdate({
              target: [platformSettings.key, platformSettings.tenantId],
              set: { value: String(val), updatedAt: new Date() },
            });
        }
      }
    });

    logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email || "",
      action: 'settings.changed',
      metadata: { keys: updatedKeys },
    });

    // Audit trail: log when secret updates are rejected (must use env vars)
    const rejectedSecretKeys = Object.keys(v).filter((k) => k in ENV_SECRET_MAP);
    if (rejectedSecretKeys.length > 0) {
      logSuperAdminAction({
        adminId: ctx.userId,
        adminEmail: ctx.user?.email || "",
        action: 'settings.secrets_updated',
        metadata: { rejectedKeys: rejectedSecretKeys },
      });
    }

    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'superadmin/settings POST', requestMethod: 'POST' });
    return apiError(err);
  }
});

