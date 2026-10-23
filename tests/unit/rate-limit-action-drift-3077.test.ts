/**
 * #3077 — the #2630 fail-closed set must actually cover the action strings
 * the routes pass. Callers drifted between `2fa_verify` and `2fa-verify`
 * spellings, and several auth endpoints (reset-password,
 * password_reset_confirm, verify-email, oauth-*) were never listed — so on
 * a proxy without a derivable client IP those endpoints bucket every caller
 * into one shared `v1_rate:<action>:unknown` key instead of refusing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

describe('isAuthScopedAction normalization (#3077)', () => {
  it('matches dash and underscore spellings of the same action', async () => {
    const { isAuthScopedAction } = await import('@/lib/rate-limit');
    expect(isAuthScopedAction('2fa-verify')).toBe(true);
    expect(isAuthScopedAction('2fa_verify')).toBe(true);
    expect(isAuthScopedAction('password_reset')).toBe(true);
    expect(isAuthScopedAction('password_reset_confirm')).toBe(true);
    expect(isAuthScopedAction('reset-password')).toBe(true);
    expect(isAuthScopedAction('verify-email')).toBe(true);
    expect(isAuthScopedAction('api')).toBe(false);
    expect(isAuthScopedAction('test')).toBe(false);
  });

  it('every literal action: passed under app/api/auth/** is auth-scoped', async () => {
    const { isAuthScopedAction } = await import('@/lib/rate-limit');
    function tsFiles(dir: string): string[] {
      let names: string[];
      try { names = readdirSync(dir); } catch { return []; }
      const out: string[] = [];
      for (const name of names) {
        const full = join(dir, name);
        let st; try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) out.push(...tsFiles(full));
        else if (name === 'route.ts') out.push(full);
      }
      return out;
    }
    const files = tsFiles(join(process.cwd(), 'app/api/auth'));
    expect(files.length).toBeGreaterThan(10);
    const seen: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf-8');
      for (const m of src.matchAll(/action:\s*'([^']+)'/g)) {
        seen.push(m[1]);
        expect(isAuthScopedAction(m[1]), `${f.slice(process.cwd().length + 1)} action '${m[1]}' escapes fail-closed`).toBe(true);
      }
    }
    expect(new Set(seen).size).toBeGreaterThan(12);
  });

  it('checkRateLimit answers 503 for an auth action when the client IP is unknown', async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit');
    vi.stubEnv('TRUST_PROXY', 'true');
    try {
      const req = new Request('http://localhost/api/auth/2fa/verify', { method: 'POST' });
      const res = await checkRateLimit(req, { action: '2fa-verify', max: 5, windowMinutes: 15 });
      expect(res).not.toBeNull();
      expect(res!.status).toBe(503);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('a non-auth action under the same unknown-IP condition is NOT failed closed', async () => {
    const { checkRateLimit, rateLimiter } = await import('@/lib/rate-limit');
    vi.stubEnv('TRUST_PROXY', 'true');
    try {
      await rateLimiter.reset('v1_rate:browse:unknown');
      const req = new Request('http://localhost/api/test');
      const res = await checkRateLimit(req, { action: 'browse', max: 100, windowMinutes: 1 });
      expect(res).toBeNull();
      await rateLimiter.reset('v1_rate:browse:unknown');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

beforeEach(() => {
  vi.resetModules();
});
