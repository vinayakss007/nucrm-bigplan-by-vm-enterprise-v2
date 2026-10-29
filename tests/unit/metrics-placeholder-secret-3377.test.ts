/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3377: `/api/metrics` authenticates with `METRICS_SECRET`, and
 * `deploy/.env.production:288` ships `METRICS_SECRET=<<<REQUIRED>>>`.
 *
 * Unlike #3374's `SETUP_KEY`, there is no length rule to hide behind here:
 * `validateEnv()` has no `METRICS_SECRET` clause at all (measured — `npx tsx`
 * with every other credential filled with a realistic value answers
 * `BOOT OK (validateEnv has no rule for it)`). So the placeholder is not an
 * accident waiting to be caught at boot; it is the bearer token, on a box that
 * starts, on a path `proxy.ts:233` lists as public.
 *
 * The contract these tests pin is the one #2221 already established for an
 * *absent* secret — fail closed, say so, emit nothing — extended to a secret
 * that is present and unfilled. A 503 that still ships samples would be worse
 * than the 401, because it would look like a working scrape target.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const PLACEHOLDER = '<<<REQUIRED>>>';
const REAL_SECRET = 'a-real-metrics-secret-9f2c47ab13de58';

const mockExecute = vi.fn();

vi.mock('ioredis', () => ({
  default: class MockIORedis {
    async connect() { return this; }
    async info() { return '# Server\r\nuptime_in_seconds:3600'; }
    async dbsize() { return 1; }
    async llen() { return 0; }
    async zcount() { return 0; }
    async get() { return null; }
    disconnect() {}
  },
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: (...args: unknown[]) => {
      mockExecute.push(args);
      return Promise.resolve({ rows: [{ '?column?': 1 }] });
    },
  },
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/metrics/route';

function req(headers: Record<string, string>) {
  return new NextRequest('http://localhost/api/metrics', { headers });
}

describe('#3377 /api/metrics does not authenticate with its own template token', () => {
  beforeEach(() => {
    mockExecute.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe.each([
    ['the stock template value, 14 chars', PLACEHOLDER],
    ['the 23-char sibling the same file ships', '<<<POSTGRES_PASSWORD>>>'],
    ["the 36-char <<<REQUIRED - change from 'admin'>>> spelling", "<<<REQUIRED - change from 'admin'>>>"],
  ])('SETUP with %s', (_label, secret) => {
    it('refuses the x-metrics-secret form and emits no sample', async () => {
      vi.stubEnv('METRICS_SECRET', secret);
      const res = await GET(req({ 'x-metrics-secret': secret }));
      const body = await res.text();
      expect(res.status).toBe(503);
      expect(body).not.toMatch(/^nucrm_/m);
      expect(mockExecute, 'a refused scrape must not reach the pool').not.toHaveBeenCalled();
    });

    it('refuses the Authorization: Bearer form too', async () => {
      vi.stubEnv('METRICS_SECRET', secret);
      const res = await GET(req({ authorization: `Bearer ${secret}` }));
      expect(res.status).toBe(503);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('names the configuration, without echoing the value', async () => {
      vi.stubEnv('METRICS_SECRET', secret);
      const body = await (await GET(req({ 'x-metrics-secret': secret }))).text();
      expect(body).toMatch(/METRICS_SECRET/);
      expect(body).not.toMatch(/<<<|>>>/);
    });
  });

  describe('the scrape keeps working where it already worked', () => {
    it('serves samples to the real secret, in both header forms', async () => {
      vi.stubEnv('METRICS_SECRET', REAL_SECRET);
      const byHeader = await GET(req({ 'x-metrics-secret': REAL_SECRET }));
      expect(byHeader.status).toBe(200);
      expect(await byHeader.text()).toMatch(/nucrm_/);

      const byBearer = await GET(req({ authorization: `Bearer ${REAL_SECRET}` }));
      expect(byBearer.status).toBe(200);
    });

    it('keeps 401 for a wrong secret — that is an auth failure, not a config one', async () => {
      vi.stubEnv('METRICS_SECRET', REAL_SECRET);
      const res = await GET(req({ 'x-metrics-secret': 'not-the-secret' }));
      expect(res.status).toBe(401);
      expect(await res.text()).toMatch(/Unauthorized/);
    });

    it('keeps 503 when the variable is absent, which is the #2221 rule', async () => {
      vi.stubEnv('METRICS_SECRET', '');
      const res = await GET(req({ 'x-metrics-secret': REAL_SECRET }));
      expect(res.status).toBe(503);
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });
});
