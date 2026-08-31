/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Environment Variable Validation
 * Validates all required environment variables at startup
 */

export interface EnvConfig {
  databaseUrl: string;
  jwtSecret: string;
  sessionSecret: string;
  appUrl: string;
  cronSecret: string;
  nodeEnv: string;
  databaseSsl: boolean;
  databasePoolSize: number;
  pgBouncerEnabled: boolean;
  resendApiKey?: string;
  sentryDsn?: string;
  encryptionKey?: string;
}

function _getRequiredEnv(name: string, example?: string): string {
  const value = process.env[name];
  if (!value) {
    const exampleCmd = example || `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `Set ${name} in your .env.local file.\n` +
      `Example: ${exampleCmd}`
    );
  }
  return value;
}

const WEAK_SECRET_PATTERNS = [
  'dev-', 'dev_', 'localhost', 'change-in-prod', 'change-me',
  'your-', 'example', 'changeme', 'test-secret', 'placeholder',
];

function validateNotWeak(name: string, value: string): void {
  const lower = value.toLowerCase();
  for (const pattern of WEAK_SECRET_PATTERNS) {
    if (lower.includes(pattern)) {
      throw new Error(
        `${name} contains a weak/development pattern: "${pattern}".\n` +
        `Generate a strong secret with: openssl rand -base64 64`
      );
    }
  }

  // Reject low-entropy values that satisfy the length check but provide almost
  // no real key strength. #1309: a bare unique-character count is a weak proxy —
  // it lets predictable patterns through (e.g. "abcabcabc…" has 3 unique chars
  // but ~1.58 bits/char). Instead measure Shannon entropy per character.
  //
  // Reference points (bits/char):
  //   "aaaa…"            -> 0.00   (rejected)
  //   "abab…"            -> 1.00   (rejected)
  //   "abcabc…"          -> ~1.58  (rejected)
  //   well-distributed hex (16 symbols) -> up to 4.00 (accepted)
  //   base64 (64 symbols)               -> up to 6.00 (accepted)
  //
  // 3.0 bits/char cleanly separates real random secrets (hex/base64/openssl)
  // from repeated or small-alphabet placeholders. A genuinely random 32-char
  // hex key carries ~128 bits total, far above any practical concern.
  const MIN_BITS_PER_CHAR = 3.0;
  const entropy = shannonEntropyPerChar(value);
  const uniqueChars = new Set(value).size;
  if (entropy < MIN_BITS_PER_CHAR) {
    throw new Error(
      `${name} has insufficient entropy (${entropy.toFixed(2)} bits/char across ` +
      `${uniqueChars} unique character${uniqueChars === 1 ? '' : 's'}; ` +
      `${MIN_BITS_PER_CHAR.toFixed(1)} required).\n` +
      `Generate a strong secret with: openssl rand -base64 64`
    );
  }
}

/**
 * Shannon entropy in bits per character for a string. 0 for empty/single-char
 * inputs. Used to reject low-entropy secrets that pass the length check.
 */
function shannonEntropyPerChar(value: string): number {
  if (value.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of value) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function getOptionalEnv(name: string, defaultValue?: string): string | undefined {
  return process.env[name] ?? defaultValue;
}

export function validateEnv(): EnvConfig {
  const errors: string[] = [];

  // Validate DATABASE_URL
  const databaseUrl = getOptionalEnv('DATABASE_URL');
  if (!databaseUrl) {
    errors.push('DATABASE_URL is required');
  } else if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
    errors.push('DATABASE_URL must be a valid PostgreSQL connection string');
  }

  // Validate JWT_SECRET
  const jwtSecret = getOptionalEnv('JWT_SECRET');
  if (!jwtSecret) {
    errors.push('JWT_SECRET is required');
  } else if (jwtSecret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters long');
  } else {
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { validateNotWeak('JWT_SECRET', jwtSecret); } catch (e: any) { errors.push(e.message); }
  }

  // Validate SESSION_SECRET
  const sessionSecret = getOptionalEnv('SESSION_SECRET');
  if (!sessionSecret) {
    errors.push('SESSION_SECRET is required');
  } else if (sessionSecret.length < 32) {
    errors.push('SESSION_SECRET must be at least 32 characters long');
  } else {
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { validateNotWeak('SESSION_SECRET', sessionSecret); } catch (e: any) { errors.push(e.message); }
  }

  // Validate NEXT_PUBLIC_APP_URL
  const appUrl = getOptionalEnv('NEXT_PUBLIC_APP_URL');
  if (!appUrl) {
    errors.push('NEXT_PUBLIC_APP_URL is required');
  } else if (!appUrl.startsWith('http://') && !appUrl.startsWith('https://')) {
    errors.push('NEXT_PUBLIC_APP_URL must start with http:// or https://');
  }

  // Validate SETUP_KEY
  const setupKey = getOptionalEnv('SETUP_KEY');
  if (!setupKey) {
    errors.push('SETUP_KEY is required');
  } else if (setupKey.length < 20) {
    errors.push('SETUP_KEY must be at least 20 characters long');
  }

  // Validate ALLOWED_ORIGINS
  const allowedOrigins = getOptionalEnv('ALLOWED_ORIGINS');
  if (!allowedOrigins) {
    errors.push('ALLOWED_ORIGINS is required (use "*" for dev or comma-separated origins)');
  }

  // Validate REDIS_URL (optional — system has in-memory fallbacks).
  // Accept both TCP schemes (redis://, rediss://) and Unix-socket schemes that
  // ioredis supports natively: redis+unix://, rediss+unix:// and unix://. The
  // URL is passed straight through to `new Redis(url)` by every consumer
  // (lib/cache, lib/feature-flags, lib/queue, lib/realtime, worker.ts), so no
  // client change is needed — only this validator gated socket URLs out.
  // (Mirrors the Unix-socket DATABASE_URL support already in lib/db/pool.ts, #1544.)
  const redisUrl = getOptionalEnv('REDIS_URL');
  const REDIS_URL_SCHEMES = ['redis://', 'rediss://', 'redis+unix://', 'rediss+unix://', 'unix://'];
  if (redisUrl && !REDIS_URL_SCHEMES.some((scheme) => redisUrl.startsWith(scheme))) {
    errors.push('REDIS_URL must be a valid Redis connection string (redis://, rediss://, redis+unix://, rediss+unix:// or unix://), or unset for in-memory fallback');
  }

  // Validate CRON_SECRET
  const cronSecret = getOptionalEnv('CRON_SECRET');
  if (!cronSecret) {
    errors.push('CRON_SECRET is required');
  } else if (cronSecret.length < 32) {
    errors.push('CRON_SECRET must be at least 32 characters long (was 16, increased for security)');
  } else {
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { validateNotWeak('CRON_SECRET', cronSecret); } catch (e: any) { errors.push(e.message); }
  }

  // Validate ENCRYPTION_KEY (for backup encryption)
  const encryptionKey = getOptionalEnv('ENCRYPTION_KEY');
  if (!encryptionKey) {
    errors.push('ENCRYPTION_KEY is required for backup encryption');
  } else if (encryptionKey.length < 32) {
    errors.push('ENCRYPTION_KEY must be at least 32 characters (hex, 64 chars recommended)');
  } else {
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { validateNotWeak('ENCRYPTION_KEY', encryptionKey); } catch (e: any) { errors.push(e.message); }
  }

  // Validate DATABASE_POOL_SIZE
  const poolSize = parseInt(getOptionalEnv('DATABASE_POOL_SIZE', '10') ?? '10', 10);
  if (isNaN(poolSize) || poolSize < 1 || poolSize > 100) {
    errors.push('DATABASE_POOL_SIZE must be between 1 and 100');
  }

  // Validate PGBOUNCER_ENABLED (optional)
  const pgBouncerRaw = getOptionalEnv('PGBOUNCER_ENABLED');
  const pgBouncerEnabled = pgBouncerRaw === 'true';

  // Throw if any validation failed
  if (errors.length > 0) {
    throw new Error(
      'Environment validation failed:\n' +
      errors.map(e => `  - ${e}`).join('\n')
    );
  }

  return {
    databaseUrl: databaseUrl!,
    jwtSecret: jwtSecret!,
    sessionSecret: sessionSecret!,
    appUrl: appUrl!,
    cronSecret: cronSecret!,
    nodeEnv: getOptionalEnv('NODE_ENV', 'development') ?? 'development',
    databaseSsl: getOptionalEnv('DATABASE_SSL', 'false') !== 'false',
    databasePoolSize: poolSize,
    pgBouncerEnabled,
    resendApiKey: getOptionalEnv('RESEND_API_KEY'),
    sentryDsn: getOptionalEnv('SENTRY_DSN'),
    encryptionKey: encryptionKey,
  };
}

/**
 * Initialize and validate environment
 * Call this at application startup
 */
export function initEnv(): EnvConfig {
  const config = validateEnv();
  
  // Only log environment details in development; never in production
  if (config.nodeEnv !== 'production') {
    console.log('✅ Environment validated successfully');
    console.log(`   NODE_ENV: ${config.nodeEnv}`);
    console.log(`   Database: ${config.databaseUrl.split('@').pop()?.split('/')[0] || 'configured'}`);
    console.log(`   Pool Size: ${config.databasePoolSize}`);
    console.log(`   SSL: ${config.databaseSsl}`);
    
    if (config.resendApiKey) {
      console.log(`   Email: ${config.resendApiKey.startsWith('re_test_') ? 'Resend (test mode)' : 'Resend (live)'}`);
    } else if (process.env.SMTP_HOST) {
      console.log(`   Email: SMTP (${process.env.SMTP_HOST})`);
    } else {
      console.log(`   Email: Not configured (dev console mode)`);
    }
    
    if (config.sentryDsn) {
      console.log(`   Sentry: Configured`);
    }
  } else if (config.nodeEnv === 'production') {
    // Production: warn only about missing critical config
    if (!config.resendApiKey && !process.env.SMTP_HOST) {
      console.error('');
      console.error('  ╔══════════════════════════════════════════════════════════════╗');
      console.error('  ║  ⚠️  WARNING: NO EMAIL PROVIDER CONFIGURED                   ║');
      console.error('  ║                                                              ║');
      console.error('  ║  Password resets, invitations, notifications will NOT send.  ║');
      console.error('  ║  Set RESEND_API_KEY or SMTP_HOST in your .env file.          ║');
      console.error('  ╚══════════════════════════════════════════════════════════════╝');
      console.error('');
    }
  }
  
  return config;
}

export default validateEnv;
