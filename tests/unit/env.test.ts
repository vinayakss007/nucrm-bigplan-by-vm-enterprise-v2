import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Strong, high-entropy fixture secrets. These intentionally use many distinct
// characters so they pass the entropy gate in validateNotWeak(); all-same or
// two-character strings (e.g. 'a'.repeat(48)) are now rejected as weak.
const STRONG_JWT = '7f3c9a1e5b8d2f4a6c0e9b7d3f1a8c5e2d4b6f0a9c3e7d1b5f8a2c4e6d0b9f3a';
const STRONG_SESSION = 'b2e8d4f6a0c9e3b7d1f5a9c2e6b4d8f0a3c7e1b5d9f3a7c0e4b8d2f6a1c5e9b3';
const STRONG_CRON = '9a1c3e5b7d9f2a4c6e8b0d1f3a5c7e9b';
const STRONG_ENCRYPTION = '4d6b8f0a2c9e1b3d5f7a9c0e2b4d6f8a1c3e5b7d9f0a2c4e6b8d1f3a5c7e9b0d';

describe('validateEnv', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
    process.env.JWT_SECRET = STRONG_JWT;
    process.env.SESSION_SECRET = STRONG_SESSION;
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.SETUP_KEY = 'a'.repeat(24);
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.CRON_SECRET = STRONG_CRON;
    process.env.ENCRYPTION_KEY = STRONG_ENCRYPTION;
    process.env.DATABASE_POOL_SIZE = '5';
    delete process.env.REDIS_URL;
    delete process.env.RESEND_API_KEY;
    delete process.env.SENTRY_DSN;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('validates correct environment', async () => {
    const { validateEnv } = await import('@/lib/env');
    const config = validateEnv();
    expect(config.databaseUrl).toBe('postgresql://user:pass@localhost:5432/test');
    expect(config.jwtSecret).toBe(STRONG_JWT);
    expect(config.sessionSecret).toBe(STRONG_SESSION);
    expect(config.appUrl).toBe('http://localhost:3000');
    expect(config.nodeEnv).toBe('development');
    expect(config.databasePoolSize).toBe(5);
    expect(config.databaseSsl).toBe(false);
    expect(config.encryptionKey).toBe(STRONG_ENCRYPTION);
  });

  it('throws when DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL;
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).toThrow('DATABASE_URL is required');
  });

  it('throws when DATABASE_URL is invalid', async () => {
    process.env.DATABASE_URL = 'mysql://localhost/test';
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).toThrow('must be a valid PostgreSQL connection string');
  });

  it('throws when JWT_SECRET is too short', async () => {
    process.env.JWT_SECRET = 'short';
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).toThrow('JWT_SECRET must be at least 32 characters long');
  });

  it('throws when JWT_SECRET is weak (dev- pattern)', async () => {
    process.env.JWT_SECRET = 'dev-' + 'x'.repeat(45);
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).toThrow('weak/development pattern');
  });

  it('throws when JWT_SECRET is weak (change-me pattern)', async () => {
    process.env.JWT_SECRET = 'change-me-' + 'x'.repeat(40);
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).toThrow('weak/development pattern');
  });

  it('throws when APP_URL is invalid', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'not-a-url';
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).toThrow('must start with http:// or https://');
  });

  it('throws when SETUP_KEY is too short', async () => {
    process.env.SETUP_KEY = 'short';
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).toThrow('SETUP_KEY must be at least 20 characters long');
  });

  it('throws when SETUP_KEY is missing', async () => {
    delete process.env.SETUP_KEY;
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).toThrow('SETUP_KEY is required');
  });

  it('throws when CRON_SECRET is too short', async () => {
    process.env.CRON_SECRET = 'short';
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).toThrow('CRON_SECRET must be at least 32 characters long');
  });

  it('throws when CRON_SECRET is weak (placeholder pattern)', async () => {
    process.env.CRON_SECRET = 'placeholder-' + 'x'.repeat(25);
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).toThrow('weak/development pattern');
  });

  it('throws when SESSION_SECRET is missing', async () => {
    delete process.env.SESSION_SECRET;
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).toThrow('SESSION_SECRET is required');
  });

  it('throws when SESSION_SECRET is weak', async () => {
    process.env.SESSION_SECRET = 'changeme' + 'x'.repeat(42);
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).toThrow('weak/development pattern');
  });

  it('throws when ENCRYPTION_KEY is missing', async () => {
    delete process.env.ENCRYPTION_KEY;
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).toThrow('ENCRYPTION_KEY is required for backup encryption');
  });

  it('throws when ENCRYPTION_KEY is too short', async () => {
    process.env.ENCRYPTION_KEY = 'short';
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).toThrow('ENCRYPTION_KEY must be at least 32 characters');
  });

  it('throws when ENCRYPTION_KEY is long enough but low-entropy (all same character)', async () => {
    // 32 chars, passes the length check, but 'aaaa...' has almost no entropy.
    process.env.ENCRYPTION_KEY = 'a'.repeat(32);
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).toThrow('ENCRYPTION_KEY has insufficient entropy');
  });

  it('throws when ENCRYPTION_KEY is a repeated two-character block', async () => {
    // 'abab...' still only has 2 unique characters.
    process.env.ENCRYPTION_KEY = 'ab'.repeat(32);
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).toThrow('ENCRYPTION_KEY has insufficient entropy');
  });

  it('accepts a strong high-entropy ENCRYPTION_KEY', async () => {
    process.env.ENCRYPTION_KEY = STRONG_ENCRYPTION;
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).not.toThrow();
    expect(validateEnv().encryptionKey).toBe(STRONG_ENCRYPTION);
  });

  it('throws when ALLOWED_ORIGINS is missing', async () => {
    delete process.env.ALLOWED_ORIGINS;
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).toThrow('ALLOWED_ORIGINS is required');
  });

  it('throws when REDIS_URL is invalid', async () => {
    process.env.REDIS_URL = 'not-redis://url';
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).toThrow('REDIS_URL must be a valid Redis connection string');
  });

  it('accepts valid REDIS_URL', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).not.toThrow();
  });

  it('accepts rediss:// REDIS_URL', async () => {
    process.env.REDIS_URL = 'rediss://localhost:6379';
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).not.toThrow();
  });

  it('accepts missing REDIS_URL', async () => {
    delete process.env.REDIS_URL;
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).not.toThrow();
  });

  it('throws when DATABASE_POOL_SIZE is invalid', async () => {
    process.env.DATABASE_POOL_SIZE = '0';
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).toThrow('DATABASE_POOL_SIZE must be between 1 and 100');

    process.env.DATABASE_POOL_SIZE = '101';
    expect(() => validateEnv()).toThrow('DATABASE_POOL_SIZE must be between 1 and 100');

    process.env.DATABASE_POOL_SIZE = 'abc';
    expect(() => validateEnv()).toThrow('DATABASE_POOL_SIZE must be between 1 and 100');
  });

  it('uses default pool size of 10 when not set', async () => {
    delete process.env.DATABASE_POOL_SIZE;
    const { validateEnv } = await import('@/lib/env');
    const config = validateEnv();
    expect(config.databasePoolSize).toBe(10);
  });

  it('parses DATABASE_SSL correctly', async () => {
    process.env.DATABASE_SSL = 'true';
    const { validateEnv } = await import('@/lib/env');
    expect(validateEnv().databaseSsl).toBe(true);

    process.env.DATABASE_SSL = 'false';
    expect(validateEnv().databaseSsl).toBe(false);
  });

  it('collects multiple errors', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.JWT_SECRET;
    const { validateEnv } = await import('@/lib/env');
    try {
      validateEnv();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      expect(err.message).toContain('DATABASE_URL');
      expect(err.message).toContain('JWT_SECRET');
    }
  });

  it('accepts optional RESEND_API_KEY and SENTRY_DSN', async () => {
    process.env.RESEND_API_KEY = 're_test_abc123';
    process.env.SENTRY_DSN = 'https://key@sentry.io/project';
    const { validateEnv } = await import('@/lib/env');
    const config = validateEnv();
    expect(config.resendApiKey).toBe('re_test_abc123');
    expect(config.sentryDsn).toBe('https://key@sentry.io/project');
  });

  it('accepts postgres:// (non-ssl) DATABASE_URL', async () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test';
    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).not.toThrow();
  });

  it('rejects all weak secret patterns', async () => {
    const patterns = ['dev-', 'dev_', 'localhost', 'change-in-prod', 'change-me',
      'your-', 'example', 'changeme', 'test-secret', 'placeholder'];
    for (const pat of patterns) {
      process.env.JWT_SECRET = pat + 'x'.repeat(40);
      const { validateEnv } = await import('@/lib/env');
      expect(() => validateEnv()).toThrow('weak/development pattern');
    }
  });
});

describe('initEnv', () => {
  const OLD_ENV = process.env;

  beforeEach(async () => {
    process.env = { ...OLD_ENV };
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
    process.env.JWT_SECRET = STRONG_JWT;
    process.env.SESSION_SECRET = STRONG_SESSION;
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.SETUP_KEY = 'a'.repeat(24);
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.CRON_SECRET = STRONG_CRON;
    process.env.ENCRYPTION_KEY = STRONG_ENCRYPTION;
    process.env.DATABASE_POOL_SIZE = '5';
    delete process.env.REDIS_URL;
    delete process.env.RESEND_API_KEY;
    delete process.env.SENTRY_DSN;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('returns valid config when env is valid', async () => {
    const { initEnv } = await import('@/lib/env');
    const config = initEnv();
    expect(config.nodeEnv).toBe('development');
    expect(config.databasePoolSize).toBe(5);
  });

  it('logs validation success messages', async () => {
    const { initEnv } = await import('@/lib/env');
    initEnv();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Environment validated successfully'));
  });

  it('re-throws validation errors', async () => {
    delete process.env.DATABASE_URL;
    const { initEnv } = await import('@/lib/env');
    expect(() => initEnv()).toThrow('DATABASE_URL is required');
  });

  it('logs Sentry config when SENTRY_DSN is set', async () => {
    process.env.SENTRY_DSN = 'https://key@sentry.io/project';
    const { initEnv } = await import('@/lib/env');
    initEnv();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Sentry: Configured'));
  });
});
