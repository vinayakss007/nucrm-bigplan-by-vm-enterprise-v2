import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody } from '@/lib/api/validate';
import { backupConfigSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { platformSettings } from '@/drizzle/schema';
import { eq, and, like } from 'drizzle-orm';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const CONFIG_KEY_PREFIX = 'tenant_backup_config:';

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

function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
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

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseConfig(rows: { key: string; value: any }[], tenantId: string): RawConfig | null {
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

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

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

    let _decryptedSecret = '';
    if (raw.secret_key_encrypted) {
      try {
        _decryptedSecret = decrypt(raw.secret_key_encrypted);
      } catch (err) {
        console.error('[backup] decryption failed', err);
      }
    }

    const updatedAt = rows[0]?.updatedAt ?? null;

    return NextResponse.json({
      data: {
        tenant_id: raw.tenant_id,
        endpoint_url: raw.endpoint_url,
        bucket: raw.bucket,
        access_key: raw.access_key,
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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

// ── PUT: Save config ──

export async function PUT(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    let rawBody;
    try { rawBody = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
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

    let secretValue = '';
    if (secret_key && secret_key.trim()) {
      secretValue = encrypt(secret_key.trim());
    }

    const fields: Record<string, string> = {
      endpoint_url: endpoint_url.trim(),
      bucket: bucket.trim(),
      access_key: access_key.trim(),
      region: region.trim(),
      backup_type,
      enabled: String(enabled),
      schedule: schedule,
      retention_days: String(retention_days),
      point_in_time_recovery: String(point_in_time_recovery),
    };

    await db.transaction(async (tx) => {
      for (const [field, value] of Object.entries(fields)) {
        await tx
          .insert(platformSettings)
          .values({
            tenantId: ctx.tenantId,
            key: `${prefix}:${field}`,
            value: value,
          })
          .onConflictDoUpdate({
            target: [platformSettings.key, platformSettings.tenantId],
            set: { value: value, updatedAt: new Date() },
          });
      }

      if (secretValue) {
        await tx
          .insert(platformSettings)
          .values({
            tenantId: ctx.tenantId,
            key: `${prefix}:secret_key`,
            value: secretValue,
          })
          .onConflictDoUpdate({
            target: [platformSettings.key, platformSettings.tenantId],
            set: { value: secretValue, updatedAt: new Date() },
          });
      }
    });

    return NextResponse.json({
      ok: true,
      data: {
        tenant_id: ctx.tenantId,
        endpoint_url: endpoint_url.trim(),
        bucket: bucket.trim(),
        access_key: access_key.trim(),
        region: region.trim(),
        backup_type,
        enabled,
        schedule,
        retention_days,
        point_in_time_recovery,
      },
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[tenant-backup-config] Error:', err);
    return apiError(err);
  }
}

// ── DELETE: Remove config ──

export async function DELETE(request: NextRequest) {
  try {
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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
