import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getConfirmDestructivePref, getPref, clearPrefsCache } from '@/lib/client-prefs';

function mockFetch(response: Record<string, unknown>, ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    json: () => Promise.resolve(response),
  } as Response);
}

describe('client-prefs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearPrefsCache();
  });

  describe('getConfirmDestructivePref', () => {
    it('returns always when no preference set', async () => {
      mockFetch({ preferences: {} });
      const result = await getConfirmDestructivePref();
      expect(result).toBe('always');
    });

    it('returns never when preference is never', async () => {
      mockFetch({ preferences: { confirm_destructive: 'never' } });
      const result = await getConfirmDestructivePref();
      expect(result).toBe('never');
    });

    it('returns danger_only when preference is danger_only', async () => {
      mockFetch({ preferences: { confirm_destructive: 'danger_only' } });
      const result = await getConfirmDestructivePref();
      expect(result).toBe('danger_only');
    });

    it('returns always for unknown values', async () => {
      mockFetch({ preferences: { confirm_destructive: 'maybe' } });
      const result = await getConfirmDestructivePref();
      expect(result).toBe('always');
    });

    it('caches result after first fetch', async () => {
      const fetch = mockFetch({ preferences: { confirm_destructive: 'never' } });
      await getConfirmDestructivePref();
      await getConfirmDestructivePref();
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('handles fetch failure gracefully', async () => {
      mockFetch({}, false);
      const result = await getConfirmDestructivePref();
      expect(result).toBe('always');
    });
  });

  describe('getPref', () => {
    it('returns the requested preference value', async () => {
      mockFetch({ preferences: { theme: 'dark', language: 'en' } });
      expect(await getPref('theme')).toBe('dark');
      expect(await getPref('language')).toBe('en');
    });

    it('returns undefined for missing key', async () => {
      mockFetch({ preferences: { theme: 'dark' } });
      expect(await getPref('nonexistent')).toBeUndefined();
    });
  });

  describe('clearPrefsCache', () => {
    it('forces re-fetch on next call', async () => {
      const fetch = mockFetch({ preferences: { theme: 'light' } });
      await getPref('theme');
      clearPrefsCache();
      await getPref('theme');
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });
});
