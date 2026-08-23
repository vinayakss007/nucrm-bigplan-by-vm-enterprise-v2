import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('getAppUrl (#1261)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('returns the configured URL with trailing slashes stripped', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example.com///';
    const { getAppUrl } = await import('@/lib/app-url');
    expect(getAppUrl()).toBe('https://crm.example.com');
  });

  it('falls back to localhost in development', async () => {
    process.env.NODE_ENV = 'development';
    const { getAppUrl } = await import('@/lib/app-url');
    expect(getAppUrl()).toBe('http://localhost:3000');
  });

  it('throws in production when NEXT_PUBLIC_APP_URL is missing', async () => {
    process.env.NODE_ENV = 'production';
    const { getAppUrl } = await import('@/lib/app-url');
    expect(() => getAppUrl()).toThrow(/NEXT_PUBLIC_APP_URL is required in production/);
  });
});
