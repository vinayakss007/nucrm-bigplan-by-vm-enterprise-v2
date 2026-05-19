import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateEnv, initEnv } from '@/lib/env';

describe('validateEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Set valid env vars for each test
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
    process.env.JWT_SECRET = 'a'.repeat(48);
    process.env.SESSION_SECRET = 'c'.repeat(48);
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.SETUP_KEY = 'a'.repeat(24);
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.CRON_SECRET = 'b'.repeat(32);
    process.env.ENCRYPTION_KEY = 'd'.repeat(64);
    process.env.DATABASE_POOL_SIZE = '5';
    delete process.env.REDIS_URL;
    delete process.env.RESEND_API_KEY;
    delete process.env.SENTRY_DSN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('validates correct environment', () => {
    const config = validateEnv();
    expect(config.databaseUrl).toBe('postgresql://user:pass@localhost:5432/test');
    expect(config.jwtSecret).toBe('a'.repeat(48));
    expect(config.sessionSecret).toBe('c'.repeat(48));
    expect(config.appUrl).toBe('http://localhost:3000');
    expect(config.nodeEnv).toBe('development');
    expect(config.databasePoolSize).toBe(5);
    expect(config.databaseSsl).toBe(false);
    expect(config.encryptionKey).toBe('d'.repeat(64));
  });

  it('throws when DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;
    expect(() => validateEnv()).toThrow('DATABASE_URL is required');
  });

  it('throws when DATABASE_URL is invalid', () => {
    process.env.DATABASE_URL = 'mysql://localhost/test';
    expect(() => validateEnv()).toThrow('must be a valid PostgreSQL connection string');
  });

  it('throws when JWT_SECRET is too short', () => {
    process.env.JWT_SECRET = 'short';
    expect(() => validateEnv()).toThrow('JWT_SECRET must be at least 32 characters long');
  });

  it('throws when APP_URL is invalid', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'not-a-url';
    expect(() => validateEnv()).toThrow('must start with http:// or https://');
  });

  it('throws when SETUP_KEY is too short', () => {
    process.env.SETUP_KEY = 'short';
    expect(() => validateEnv()).toThrow('SETUP_KEY must be at least 20 characters long');
  });

  it('throws when CRON_SECRET is too short', () => {
    process.env.CRON_SECRET = 'short';
    expect(() => validateEnv()).toThrow('CRON_SECRET must be at least 32 characters long');
  });

  it('throws when SESSION_SECRET is missing', () => {
    delete process.env.SESSION_SECRET;
    expect(() => validateEnv()).toThrow('SESSION_SECRET is required');
  });

  it('throws when ENCRYPTION_KEY is missing', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => validateEnv()).toThrow('ENCRYPTION_KEY is required for backup encryption');
  });

  it('throws when ALLOWED_ORIGINS is missing', () => {
    delete process.env.ALLOWED_ORIGINS;
    expect(() => validateEnv()).toThrow('ALLOWED_ORIGINS is required');
  });

  it('throws when REDIS_URL is invalid', () => {
    process.env.REDIS_URL = 'not-redis://url';
    expect(() => validateEnv()).toThrow('REDIS_URL must be a valid Redis connection string');
  });

  it('accepts valid REDIS_URL', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    expect(() => validateEnv()).not.toThrow();
  });

  it('accepts rediss:// REDIS_URL', () => {
    process.env.REDIS_URL = 'rediss://localhost:6379';
    expect(() => validateEnv()).not.toThrow();
  });

  it('throws when DATABASE_POOL_SIZE is invalid', () => {
    process.env.DATABASE_POOL_SIZE = '0';
    expect(() => validateEnv()).toThrow('DATABASE_POOL_SIZE must be between 1 and 100');
    process.env.DATABASE_POOL_SIZE = '101';
    expect(() => validateEnv()).toThrow('DATABASE_POOL_SIZE must be between 1 and 100');
    process.env.DATABASE_POOL_SIZE = 'abc';
    expect(() => validateEnv()).toThrow('DATABASE_POOL_SIZE must be between 1 and 100');
  });

  it('parses DATABASE_SSL correctly', () => {
    process.env.DATABASE_SSL = 'true';
    const config = validateEnv();
    expect(config.databaseSsl).toBe(true);

    process.env.DATABASE_SSL = 'false';
    const config2 = validateEnv();
    expect(config2.databaseSsl).toBe(false);
  });

  it('collects multiple errors', () => {
    delete process.env.DATABASE_URL;
    delete process.env.JWT_SECRET;
    try {
      validateEnv();
    } catch (err: any) {
      expect(err.message).toContain('DATABASE_URL');
      expect(err.message).toContain('JWT_SECRET');
    }
  });
});
