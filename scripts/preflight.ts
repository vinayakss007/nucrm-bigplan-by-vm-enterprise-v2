#!/usr/bin/env npx tsx
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Startup preflight — fail fast so the app never boots half-broken.
 *
 * "When started, everything works" means the process either comes up fully
 * functional or refuses to start with a clear, actionable reason. This script
 * validates every critical startup dependency BEFORE `next start`:
 *
 *   1. Required env vars are present.
 *   2. Secrets are real (not the .env.example placeholders, not too short).
 *   3. The database is reachable (SELECT 1).
 *   4. Migrations have been applied (drizzle ledger is non-empty).
 *   5. TLS is enforced for the DB connection in production.
 *   6. Redis is reachable when REDIS_URL is configured.
 *   7. Email is configured (Resend or SMTP).
 *   8. Off-site backup storage is configured (so backups survive host loss).
 *
 * Severity model:
 *   - FAIL  → hard blocker. Process exits non-zero; do not start the app.
 *   - WARN  → degraded but serviceable in the current NODE_ENV. In production
 *             some warnings are promoted to failures (email, backup storage).
 *
 * Usage:
 *   npx tsx scripts/preflight.ts          # respects NODE_ENV
 *   npm run preflight
 *   STRICT=true npm run preflight         # treat all warnings as failures
 *
 * Exit codes: 0 = ok (warnings allowed), 1 = one or more hard failures.
 */

import { Pool } from 'pg';

const IS_PROD = process.env.NODE_ENV === 'production';
const STRICT = process.env.STRICT === 'true';

type Level = 'ok' | 'warn' | 'fail';
interface Result {
  name: string;
  level: Level;
  detail: string;
}

const results: Result[] = [];
const ok = (name: string, detail = '') => results.push({ name, level: 'ok', detail });
const warn = (name: string, detail: string) => results.push({ name, level: 'warn', detail });
const fail = (name: string, detail: string) => results.push({ name, level: 'fail', detail });

/**
 * Record a check that is a hard failure in production but only a warning
 * elsewhere (e.g. email, off-site backups — needed for a real deploy, not for
 * local dev).
 */
const prodFail = (name: string, detail: string) =>
  IS_PROD ? fail(name, detail) : warn(name, detail);

// ── Known placeholder values from .env.example that must never ship ──────────
const PLACEHOLDER_SECRETS = new Set([
  '',
  're_xxxxxx',
  'your-access-key',
  'your-secret-key',
  'generate-a-random-password-here',
  'sk_test_xxxxxx',
  'whsec_xxxxxx',
]);

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.trim();
  if (PLACEHOLDER_SECRETS.has(v)) return true;
  return /^(changeme|placeholder|example|test|dev|todo|xxx+)$/i.test(v);
}

// ── 1 + 2. Required env vars + secret strength ───────────────────────────────
function checkEnv(): void {
  const required = ['DATABASE_URL', 'JWT_SECRET', 'SESSION_SECRET', 'NEXT_PUBLIC_APP_URL', 'CRON_SECRET'];
  for (const key of required) {
    const val = process.env[key];
    if (!val || val.trim() === '') {
      fail(`env:${key}`, 'required but not set');
    } else {
      ok(`env:${key}`);
    }
  }

  // Secret strength: reject placeholders and too-short values for the crypto secrets.
  const secrets = ['JWT_SECRET', 'SESSION_SECRET', 'CRON_SECRET'];
  for (const key of secrets) {
    const val = process.env[key];
    if (!val) continue; // already reported by the required check
    if (isPlaceholder(val)) {
      fail(`secret:${key}`, 'is a placeholder/weak value — generate a real secret');
    } else if (val.length < 16) {
      const detail = `only ${val.length} chars — use >= 32 (openssl rand -base64 48)`;
      IS_PROD ? fail(`secret:${key}`, detail) : warn(`secret:${key}`, detail);
    } else {
      ok(`secret:${key}`);
    }
  }
}

// ── 3 + 4 + 5. Database reachable, migrated, TLS-enforced ────────────────────
async function checkDatabase(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return; // reported by checkEnv

  // 5. TLS enforcement in production.
  if (/sslmode=disable/i.test(url)) {
    if (IS_PROD) {
      fail('db:tls', 'sslmode=disable in production exposes credentials + PII (SOC2/GDPR blocker)');
    } else {
      warn('db:tls', 'sslmode=disable — acceptable for local/dev only, never production');
    }
  } else {
    ok('db:tls');
  }

  // Use the app's shared SSL policy so this matches every runtime pool.
  let ssl: false | { rejectUnauthorized: boolean } = false;
  try {
    const mod = await import('../lib/db/ssl-config');
    ssl = mod.pgSslConfig();
  } catch {
    // Fall back to no ssl override if the helper can't be loaded.
  }

  const pool = new Pool({ connectionString: url, max: 1, ssl, connectionTimeoutMillis: 8000 });
  try {
    // 3. Reachable?
    await pool.query('SELECT 1');
    ok('db:reachable');

    // 4. Migrated? drizzle.__drizzle_migrations is the ledger migrate() consults.
    const ledger = await pool.query<{ present: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
       ) AS present`
    );
    if (!ledger.rows[0]?.present) {
      // No ledger at all — schema was never migrated (or built via db:push).
      fail('db:migrations', 'drizzle migration ledger absent — run `npm run db:migrate`');
    } else {
      const count = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM "drizzle"."__drizzle_migrations"`
      );
      const n = parseInt(count.rows[0]?.n ?? '0', 10);
      if (n === 0) {
        fail('db:migrations', 'migration ledger is empty — run `npm run db:migrate`');
      } else {
        ok('db:migrations', `${n} migration(s) applied`);
      }
    }
  } catch (err) {
    fail('db:reachable', `cannot connect: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await pool.end().catch(() => {});
  }
}

// ── 6. Redis reachable (only when configured) ────────────────────────────────
async function checkRedis(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) {
    warn('redis', 'REDIS_URL not set — rate limiting/cron dedup fall back to in-memory (single-instance only)');
    return;
  }
  try {
    const IORedis = (await import('ioredis')).default;
    const client = new IORedis(url, {
      lazyConnect: true,
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    try {
      await client.connect();
      const pong = await client.ping();
      if (pong === 'PONG') ok('redis'); else warn('redis', `unexpected ping reply: ${pong}`);
    } finally {
      client.disconnect();
    }
  } catch (err) {
    prodFail('redis', `REDIS_URL set but unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── 7. Email configured ──────────────────────────────────────────────────────
function checkEmail(): void {
  const resend = process.env.RESEND_API_KEY;
  const smtpHost = process.env.SMTP_HOST;
  const resendOk = !!resend && !isPlaceholder(resend);
  const smtpOk = !!smtpHost && smtpHost.trim() !== '';

  if (resendOk || smtpOk) {
    ok('email', resendOk ? 'Resend' : 'SMTP');
  } else {
    prodFail('email', 'no RESEND_API_KEY or SMTP_HOST — password resets/invites/notifications will not send');
  }
}

// ── 8. Off-site backup storage ────────────────────────────────────────────────
async function checkBackupStorage(): Promise<void> {
  try {
    const { getS3Config } = await import('../lib/storage/s3-config');
    const cfg = getS3Config();
    const bucket = cfg.backupBucket || (cfg as { bucket?: string }).bucket;
    if (cfg.configured && bucket) {
      ok('backup:storage', `off-site bucket "${bucket}"`);
    } else {
      prodFail(
        'backup:storage',
        'S3/R2 not fully configured — backups stay on the host and do NOT survive host loss'
      );
    }
  } catch (err) {
    prodFail('backup:storage', `could not resolve S3 config: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  console.log(`\nNuCRM preflight  (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}${STRICT ? ', STRICT' : ''})`);
  console.log('='.repeat(52));

  checkEnv();
  await checkDatabase();
  await checkRedis();
  checkEmail();
  await checkBackupStorage();

  const icon: Record<Level, string> = { ok: 'ok  ', warn: 'WARN', fail: 'FAIL' };
  for (const r of results) {
    console.log(`  [${icon[r.level]}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }

  const failures = results.filter((r) => r.level === 'fail');
  const warnings = results.filter((r) => r.level === 'warn');

  // In STRICT mode, warnings are promoted to hard failures.
  const hardFailCount = failures.length + (STRICT ? warnings.length : 0);

  console.log('');
  console.log(
    `Summary: ${results.filter((r) => r.level === 'ok').length} ok, ` +
    `${warnings.length} warn, ${failures.length} fail`
  );

  if (hardFailCount > 0) {
    console.error(`\nPREFLIGHT FAILED — refusing to start (${hardFailCount} blocker(s)). Fix the above and retry.\n`);
    process.exit(1);
  }
  console.log('\nPREFLIGHT PASSED — safe to start.\n');
}

main().catch((err) => {
  console.error('\npreflight crashed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
