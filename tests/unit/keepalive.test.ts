import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('keepalive', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('getDatabaseType returns unknown when no DB url', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.NEXT_PUBLIC_DATABASE_URL;
    const { getDatabaseType } = await import('@/lib/keepalive');
    expect(getDatabaseType()).toBe('unknown');
  });

  it('getDatabaseType returns traditional for non-neon URL', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/db';
    const { getDatabaseType } = await import('@/lib/keepalive');
    expect(getDatabaseType()).toBe('traditional');
  });

  it('getDatabaseType returns neon for neon.tech URL', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@ep-something.neon.tech/db';
    const { getDatabaseType } = await import('@/lib/keepalive');
    expect(getDatabaseType()).toBe('neon');
  });

  it('getDatabaseType returns neon for neondb URL', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@project.neondb.io/db';
    const { getDatabaseType } = await import('@/lib/keepalive');
    expect(getDatabaseType()).toBe('neon');
  });

  it('isKeepAliveEnabled returns false before start', async () => {
    const { isKeepAliveEnabled } = await import('@/lib/keepalive');
    expect(isKeepAliveEnabled()).toBe(false);
  });

  it('startNeonKeepAlive with forceEnable logs and sets enabled', async () => {
    const { startNeonKeepAlive, isKeepAliveEnabled, stopNeonKeepAlive } = await import('@/lib/keepalive');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    startNeonKeepAlive({ forceEnable: true, checkInterval: 60000, idleThreshold: 60000 });
    expect(isKeepAliveEnabled()).toBe(true);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
    stopNeonKeepAlive();
  });

  it('stopNeonKeepAlive sets enabled to false', async () => {
    const { startNeonKeepAlive, isKeepAliveEnabled, stopNeonKeepAlive } = await import('@/lib/keepalive');
    startNeonKeepAlive({ forceEnable: true });
    expect(isKeepAliveEnabled()).toBe(true);
    stopNeonKeepAlive();
    expect(isKeepAliveEnabled()).toBe(false);
  });

  it('forceKeepAlive does nothing when disabled', async () => {
    const { forceKeepAlive } = await import('@/lib/keepalive');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    forceKeepAlive();
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
