/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { backupConfigSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { platformSettings } from '@/drizzle/schema';
import { eq, and, like, sql } from 'drizzle-orm';
import { createCipheriv, randomBytes, scryptSync } from 'crypto';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

const ALGORITHM = 'aes-256-gcm';
const CONFIG_KEY_PREFIX = 'tenant_backup_config:';

// #2221: masked-display pattern shared with app/api/superadmin/settings —
// reads show `****<last4>`, and an echoed mask on write means "unchanged".
const MASKED_VALUE_PATTERN = /^\*{4}/;

function maskAccessKey(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

// ── Encryption helpers ─────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const secret = process.env['ENCRYPTION_KEY'];
  if (!secret) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is required.\n' +
      'Generate a secure 64-char hex key: openssl rand -hex 32'
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return Buffer.from(secret, 'hex');
  }
  return scryptSync(secret, 'tenant-backup-salt-v2', 32);
}

function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

// ── Parse config from DB rows ──────────────────────────────────

interface RawConfig {
  endpoint_url: string;
  bucket: string;
  access_key: string;
  secret_key_encrypted: string;
  region: string;
  backup_type: string;
  enabled: string;
  tenant_id: string;
  schedule: string;
  retention_days: string;
  point_in_time_recovery: string;
}

function parseConfig(rows: { key: string; value: unknown }[], tenantId: string): RawConfig | null {
  const prefix = `${CONFIG_KEY_PREFIX}${tenantId}`;
  const config: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.startsWith(prefix)) {
      const field = row.key.replace(prefix + ':', '');
      config[field] = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
    }
  }

  if (!config['bucket'] && !config['endpoint_url']) return null;

  return {
    endpoint_url: config['endpoint_url'] || '',
    bucket: config['bucket'] || '',
    access_key: config['access_key'] || '',
    secret_key_encrypted: config['secret_key'] || '',
    region: config['region'] || 'us-east-1',
    backup_type: config['backup_type'] || 'full',
    enabled: config['enabled'] ?? 'true',
    tenant_id: tenantId,
    schedule: config['schedule'] || '0 2 * * *', // Default: daily at 2 AM
    retention_days: config['retention_days'] || '30', // Default: 30 days
    point_in_time_recovery: config['point_in_time_recovery'] ?? 'false',
  };
}

// ── GET: Read config ──

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    // #2221: PUT/DELETE already require admin; GET exposed the S3 access key
    // (and, via the now-removed dead decrypt path, a decrypted secret key in
    // memory one edit away from being echoed) to every tenant member. Backup
    // credentials are an admin-surface — gate reads the same way.
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const rows = await db
      .select({ 
        key: platformSettings.key, 
        value: platformSettings.value, 
        updatedAt: platformSettings.updatedAt 
      })
      .from(platformSettings)
      .where(and(
        eq(platformSettings.tenantId, ctx.tenantId),
        like(platformSettings.key, `${CONFIG_KEY_PREFIX}${ctx.tenantId}:%`)
      ));

    const raw = parseConfig(rows, ctx.tenantId);
    if (!raw) {
      return NextResponse.json({ data: null });
    }

    const updatedAt = rows[0]?.updatedAt ?? null;

    return NextResponse.json({
      data: {
        tenant_id: raw.tenant_id,
        endpoint_url: raw.endpoint_url,
        bucket: raw.bucket,
        // #2221: masked display only — the plaintext access key never leaves
        // the server. PUT treats a echoed `****…` value as "unchanged".
        access_key: maskAccessKey(raw.access_key),
        region: raw.region,
        backup_type: raw.backup_type,
        enabled: raw.enabled === 'true',
        schedule: raw.schedule,
        retention_days: parseInt(raw.retention_days) || 30,
        point_in_time_recovery: raw.point_in_time_recovery === 'true',
        created_at: updatedAt,
        updated_at: updatedAt,
      },
    });
 
 
  } catch (err) {
    return apiError(err);
  }
});

// ── PUT: Save config ──

export const PUT = withApiRoute(async (request: NextRequest) => {
  try {
  const limited = await rateLimitMutating(request, 'settings', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    let rawBody;
    try { rawBody = await readJsonBody(request); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const validated = validateBody(backupConfigSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const {
      endpoint_url = '',
      bucket,
      access_key = '',
      secret_key,
      region = 'us-east-1',
      backup_type = 'full',
      enabled = true,
      schedule = '0 2 * * *',
      retention_days = 30,
      point_in_time_recovery = false,
    } = v;

    if (!bucket || !bucket.trim()) {
      return NextResponse.json({ error: 'Bucket name is required' }, { status: 400 });
    }
    if (!access_key || !access_key.trim()) {
      return NextResponse.json({ error: 'Access key is required' }, { status: 400 });
    }

    const prefix = `${CONFIG_KEY_PREFIX}${ctx.tenantId}`;

    // #2221: GET now returns a masked display value (`****last4`). A save that
    // echoes that mask unchanged must keep the stored access key instead of
    // overwriting it with the mask — same convention as secret_key (blank /
    // masked = leave as-is).
    let effectiveAccessKey = access_key.trim();
    if (MASKED_VALUE_PATTERN.test(effectiveAccessKey)) {
      const [storedAccessKeyRow] = await db
        .select({ value: platformSettings.value })
        .from(platformSettings)
        .where(and(
          eq(platformSettings.tenantId, ctx.tenantId),
          eq(platformSettings.key, `${prefix}:access_key`),
        ))
        .limit(1);
      const stored = typeof storedAccessKeyRow?.value === 'string' ? storedAccessKeyRow.value : '';
      if (!stored) {
        return NextResponse.json({ error: 'Access key is required' }, { status: 400 });
      }
      effectiveAccessKey = stored;
    }

    let secretValue = '';
    if (secret_key && secret_key.trim()) {
      secretValue = encrypt(secret_key.trim());
    }

    const fields: Record<string, string> = {
      endpoint_url: endpoint_url.trim(),
      bucket: bucket.trim(),
      access_key: effectiveAccessKey,
      region: region.trim(),
      backup_type,
      enabled: String(enabled),
      schedule: schedule,
      retention_days: String(retention_days),
      point_in_time_recovery: String(point_in_time_recovery),
    };

    // Read existing config row's id + updatedAt for concurrency check
    const [existingConfig] = await db
      .select({ id: platformSettings.id, updatedAt: platformSettings.updatedAt })
      .from(platformSettings)
      .where(and(
        eq(platformSettings.tenantId, ctx.tenantId),
        eq(platformSettings.key, `${prefix}:bucket`),
      ))
      .limit(1);

    const expectedUpdatedAt: string | Date | null | undefined = (rawBody as Record<string, unknown>).expectedUpdatedAt as string | Date | null ?? (rawBody as Record<string, unknown>)._updated_at as string | Date | null ?? existingConfig?.updatedAt;
    const guard = await concurrencyGuard(db, platformSettings, existingConfig?.id ?? null, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    await db.transaction(async (tx) => {
      const settingsToInsert = Object.entries(fields).map(([field, value]) => ({
        tenantId: ctx.tenantId,
        key: `${prefix}:${field}`,
        value: value,
      }));

      if (secretValue) {
        settingsToInsert.push({
          tenantId: ctx.tenantId,
          key: `${prefix}:secret_key`,
          value: secretValue,
        });
      }

      if (settingsToInsert.length > 0) {
        await tx
          .insert(platformSettings)
          .values(settingsToInsert)
          .onConflictDoUpdate({
            target: [platformSettings.key, platformSettings.tenantId],
            // partial index: the predicate must be restated for conflict inference
            targetWhere: sql`${platformSettings.tenantId} is not null`,
            set: {
              value: sql`EXCLUDED.value`,
              updatedAt: new Date()
            },
          });
      }
    });

    return NextResponse.json({
      ok: true,
      data: {
        tenant_id: ctx.tenantId,
        endpoint_url: endpoint_url.trim(),
        bucket: bucket.trim(),
        // #2221: masked display, same as GET — the write response must not
        // become an alternate leak channel for the plaintext key.
        access_key: maskAccessKey(effectiveAccessKey),
        region: region.trim(),
        backup_type,
        enabled,
        schedule,
        retention_days,
        point_in_time_recovery,
      },
    });
 
 
  } catch (err) {
    await logError({ error: err, context: 'tenant-backup-config PUT', requestMethod: 'PUT' });
    return apiError(err);
  }
});

// ── DELETE: Remove config ──

export const DELETE = withApiRoute(async (request: NextRequest) => {
  try {
  const limited = await rateLimitMutating(request, 'settings', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    await db
      .delete(platformSettings)
      .where(and(
        eq(platformSettings.tenantId, ctx.tenantId),
        like(platformSettings.key, `${CONFIG_KEY_PREFIX}${ctx.tenantId}:%`)
      ));

    return NextResponse.json({ ok: true });
 
 
  } catch (err) {
    return apiError(err);
  }
});
