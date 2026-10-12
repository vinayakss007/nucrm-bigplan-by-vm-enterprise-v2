import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * CI guard for Issue #2273 (HIGH): the app port served next DEV bundles —
 * readable per-module source chunks, 200 .js.map files, live HMR — while
 * /api/health stayed green. The deploy gate now fails a "healthy" web that is
 * actually a dev server: `next start` 404s on /_next/webpack-hmr; anything
 * else (200, or a held-open stream that trips curl's max-time -> 000) means
 * dev-mode source disclosure on the app port.
 */

const WF = readFileSync(join(import.meta.dirname!, '..', '..', '.github/workflows/deploy.yml'), 'utf8');

describe('deploy.yml dev-server probe (#2273)', () => {
  it('defines the probe against the HMR endpoint with a timeout', () => {
    expect(WF).toContain('dev_server_exposed()');
    expect(WF).toContain('/_next/webpack-hmr');
    expect(WF).toMatch(/--max-time 4 \\\n\s*"http:\/\/127\.0\.0\.1:\$1\/_next\/webpack-hmr"/);
    expect(WF).toMatch(/\[ "\$DEV_CODE" != "404" \]/);
  });

  it('gates the healthy return on the probe and aborts otherwise', () => {
    const fn = WF.slice(WF.indexOf('restart_and_wait() {'), WF.indexOf('BG_APPS='));
    const call = fn.indexOf('dev_server_exposed "$PORT"');
    const ok = fn.indexOf('return 0');
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(ok);
    expect(fn).toContain('#2273');
    expect(fn).toContain('DEV_CODE');
  });

  it('success log line reports the prod-mode probe', () => {
    expect(WF).toContain('(prod-mode probe: 404 on HMR)');
  });

  it('keeps the #2300 structure intact (both call sites still deploy_all_and_wait)', () => {
    expect((WF.match(/if deploy_all_and_wait; then/g) || []).length).toBe(2);
    expect(WF).toContain('BG_APPS="worker cron"');
  });
});
