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
  resendApiKey?: string;
  sentryDsn?: string;
  encryptionKey?: string;
}

function getRequiredEnv(name: string, example?: string): string {
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
    try { validateNotWeak('JWT_SECRET', jwtSecret); } catch (e: any) { errors.push(e.message); }
  }

  // Validate SESSION_SECRET
  const sessionSecret = getOptionalEnv('SESSION_SECRET');
  if (!sessionSecret) {
    errors.push('SESSION_SECRET is required');
  } else if (sessionSecret.length < 32) {
    errors.push('SESSION_SECRET must be at least 32 characters long');
  } else {
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

  // Validate REDIS_URL (optional — system has in-memory fallbacks)
  const redisUrl = getOptionalEnv('REDIS_URL');
  if (redisUrl && !redisUrl.startsWith('redis://') && !redisUrl.startsWith('rediss://')) {
    errors.push('REDIS_URL must be a valid Redis connection string (or unset for in-memory fallback)');
  }

  // Validate CRON_SECRET
  const cronSecret = getOptionalEnv('CRON_SECRET');
  if (!cronSecret) {
    errors.push('CRON_SECRET is required');
  } else if (cronSecret.length < 32) {
    errors.push('CRON_SECRET must be at least 32 characters long (was 16, increased for security)');
  } else {
    try { validateNotWeak('CRON_SECRET', cronSecret); } catch (e: any) { errors.push(e.message); }
  }

  // Validate ENCRYPTION_KEY (for backup encryption)
  const encryptionKey = getOptionalEnv('ENCRYPTION_KEY');
  if (!encryptionKey) {
    errors.push('ENCRYPTION_KEY is required for backup encryption');
  } else if (encryptionKey.length < 32) {
    errors.push('ENCRYPTION_KEY must be at least 32 characters (hex, 64 chars recommended)');
  }

  // Validate DATABASE_POOL_SIZE
  const poolSize = parseInt(getOptionalEnv('DATABASE_POOL_SIZE', '10') ?? '10', 10);
  if (isNaN(poolSize) || poolSize < 1 || poolSize > 100) {
    errors.push('DATABASE_POOL_SIZE must be between 1 and 100');
  }

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
  
  console.log('✅ Environment validated successfully');
  console.log(`   NODE_ENV: ${config.nodeEnv}`);
  console.log(`   Database: ${config.databaseUrl.split('@').pop()?.split('/')[0] || 'configured'}`);
  console.log(`   Pool Size: ${config.databasePoolSize}`);
  console.log(`   SSL: ${config.databaseSsl}`);
  
  if (config.resendApiKey) {
    console.log(`   Email: ${config.resendApiKey.startsWith('re_test_') ? 'Resend (test mode)' : 'Resend (live)'}`);
  } else {
    console.log(`   Email: Not configured (mock mode)`);
  }
  
  if (config.sentryDsn) {
    console.log(`   Sentry: Configured`);
  }
  
  return config;
}

export default validateEnv;
