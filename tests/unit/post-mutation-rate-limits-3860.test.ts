import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readdirSync, statSync } from 'node:fs';

const MATRIX: Array<[string, string]> = [
  ['app/api/tenant/2fa/verify/route.ts', 'twoFactor'],
  ['app/api/tenant/2fa/setup/route.ts', 'twoFactor'],
  ['app/api/tenant/2fa/disable/route.ts', 'twoFactor'],
  ['app/api/tenant/invite/send/route.ts', 'portalClients'],
  ['app/api/tenant/custom-entities/route.ts', 'customFields'],
  ['app/api/tenant/forms/[id]/analytics/route.ts', 'forms'],
  ['app/api/tenant/plugins/[id]/execute/route.ts', 'plugins'],
  ['app/api/tenant/chat/route.ts', 'chat'],
  ['app/api/tenant/reports/run/route.ts', 'reports'],
  ['app/api/tenant/workflows/[id]/run/route.ts', 'workflows'],
  ['app/api/tenant/billing/portal/route.ts', 'billing'],
  ['app/api/tenant/compliance/gdpr/route.ts', 'compliance'],
  ['app/api/tenant/onboarding/complete/route.ts', 'modules'],
  ['app/api/tenant/webhooks/dlq/route.ts', 'webhooks'],
  ['app/api/tenant/modules/setup/route.ts', 'modules'],
];

function postHandler(src: string): string {
  const start = src.indexOf('export const POST =');
  expect(start).toBeGreaterThanOrEqual(0);
  const next = src.indexOf('\nexport const ', start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? routeFiles(path) : entry === 'route.ts' ? [path] : [];
  });
}

describe('high-exposure tenant POST mutations are rate-limited (#3860)', () => {
  for (const [file, entity] of MATRIX) {
    it(`${file} limits POST before auth`, () => {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      const body = postHandler(src);
      const limit = body.indexOf(`rateLimitMutating(`);
      const auth = body.indexOf('requireAuth(');
      expect(limit).toBeGreaterThanOrEqual(0);
      expect(limit).toBeLessThan(auth);
      expect(body).toContain(`'${entity}', 'post'`);
    });
  }

  it('does not let new ungated POST routes accumulate', () => {
    const ungated = routeFiles(join(process.cwd(), 'app/api/tenant')).filter((file) => {
      const src = readFileSync(file, 'utf8');
      return src.includes('export const POST') && !/rateLimit|checkRateLimit/.test(src);
    });
    expect(ungated.length).toBeLessThanOrEqual(48);
  });

  it('uses a strict 5/min bucket for 2FA verification', async () => {
    const { rateLimitMutating } = await import('@/lib/api/mutating-rate-limit');
    const src = readFileSync(join(process.cwd(), 'lib/api/mutating-rate-limit.ts'), 'utf8');
    expect(src).toContain('twoFactor: { post: 5, patch: 5, delete: 5 }');
    expect(typeof rateLimitMutating).toBe('function');
  });
});
