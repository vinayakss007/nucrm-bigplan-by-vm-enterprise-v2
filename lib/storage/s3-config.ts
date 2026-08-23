/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Centralised S3 / R2 configuration resolution.
 *
 * WHY THIS EXISTS
 * ---------------
 * Credentials were previously read directly from `process.env.S3_ACCESS_KEY_ID`
 * in several places, while `docker-compose.yml` only ever exported
 * `S3_ACCESS_KEY` / `S3_SECRET_KEY`. The result was silent, total failure:
 *
 *   - `if (process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID)` was always
 *     false under Docker, so database backups were never uploaded off-box.
 *   - Backups stayed in `/tmp/nucrm-backups` inside an ephemeral container,
 *     so every container restart destroyed the entire backup history while the
 *     `backup_records` table still reported `status = 'completed'`.
 *
 * Every S3 consumer must now resolve configuration through this module so that
 * naming drift can never silently disable off-site storage again.
 */

/** Canonical name first, then historical aliases. */
const ACCESS_KEY_VARS = ['S3_ACCESS_KEY_ID', 'S3_ACCESS_KEY', 'AWS_ACCESS_KEY_ID'] as const;
const SECRET_KEY_VARS = ['S3_SECRET_ACCESS_KEY', 'S3_SECRET_KEY', 'AWS_SECRET_ACCESS_KEY'] as const;

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface S3Config {
  credentials: S3Credentials;
  region: string;
  endpoint: string | undefined;
  /** Bucket used for uploaded user files. */
  bucket: string | undefined;
  /** Bucket used for database backups. Falls back to `bucket`. */
  backupBucket: string | undefined;
  /** True when a bucket and complete credentials are all present. */
  configured: boolean;
  /** `s3_r2` when pointed at Cloudflare R2, otherwise `s3`. */
  storageType: 's3' | 's3_r2';
  /** Env var names that supplied the credentials, for diagnostics. */
  resolvedFrom: { accessKeyId: string | null; secretAccessKey: string | null };
}

function firstPresent(names: readonly string[]): { value: string; name: string } | null {
  for (const name of names) {
    const raw = process.env[name];
    if (typeof raw === 'string' && raw.trim() !== '') {
      return { value: raw.trim(), name };
    }
  }
  return null;
}

/**
 * Resolve S3 configuration from the environment.
 *
 * Reads `process.env` on every call rather than caching, because Next.js route
 * handlers and the worker process load environment variables at different
 * points in their lifecycle.
 */
export function getS3Config(): S3Config {
  const access = firstPresent(ACCESS_KEY_VARS);
  const secret = firstPresent(SECRET_KEY_VARS);

  const endpoint = process.env['S3_ENDPOINT']?.trim() || undefined;
  const bucket = process.env['S3_BUCKET']?.trim() || undefined;
  // BACKUP_BUCKET is optional; backups land in the main bucket when unset.
  const backupBucket = process.env['BACKUP_BUCKET']?.trim() || bucket;
  const isR2 = Boolean(endpoint?.includes('r2'));

  return {
    credentials: {
      accessKeyId: access?.value ?? '',
      secretAccessKey: secret?.value ?? '',
    },
    // Cloudflare R2 requires the literal region "auto"; AWS S3 needs a real
    // region. Default per-provider so neither is silently misconfigured.
    region: process.env['S3_REGION']?.trim() || (isR2 ? 'auto' : 'us-east-1'),
    endpoint,
    bucket,
    backupBucket,
    configured: Boolean(access && secret && bucket),
    storageType: isR2 ? 's3_r2' : 's3',
    resolvedFrom: {
      accessKeyId: access?.name ?? null,
      secretAccessKey: secret?.name ?? null,
    },
  };
}

/**
 * True when off-site backup storage is fully configured.
 *
 * Prefer this over ad-hoc `process.env` checks so that a partially configured
 * environment is treated as "not configured" instead of producing an S3 client
 * with empty-string credentials that fails only at request time.
 */
export function isS3Configured(): boolean {
  return getS3Config().configured;
}

/**
 * Human-readable explanation of why S3 is unavailable, for logs and alerts.
 * Returns `null` when configuration is complete.
 */
export function describeS3ConfigGap(): string | null {
  const cfg = getS3Config();
  if (cfg.configured) return null;

  const missing: string[] = [];
  if (!cfg.bucket) missing.push('S3_BUCKET');
  if (!cfg.credentials.accessKeyId) missing.push(`one of ${ACCESS_KEY_VARS.join(' | ')}`);
  if (!cfg.credentials.secretAccessKey) missing.push(`one of ${SECRET_KEY_VARS.join(' | ')}`);

  return `S3 storage not configured; missing: ${missing.join(', ')}`;
}
