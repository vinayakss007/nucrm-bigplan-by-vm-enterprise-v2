/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * #3508 — Production compose image runs prod:start:custom binding 0.0.0.0 (Finding B5).
 *
 * Finding B5: `package.json` previously configured `prod:start:custom` with `-H 127.0.0.1`.
 * In container deployments (where Dockerfile sets `CMD ["npm", "run", "prod:start:custom"]`),
 * this bound Next.js strictly to container loopback, causing connection refused (502)
 * when nginx or other containers on the bridge network proxied traffic to `app:3000`.
 *
 * `prod:start:custom` now binds `-H 0.0.0.0`.
 */

const ROOT = process.cwd();
const PKG_PATH = join(ROOT, 'package.json');
const DOCKERFILE_PATH = join(ROOT, 'Dockerfile');

describe('production container bind address (#3508)', () => {
  it('configures prod:start:custom to bind 0.0.0.0', () => {
    const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8')) as { scripts?: Record<string, string> };
    const script = pkg.scripts?.['prod:start:custom'];
    expect(script).toBeDefined();
    expect(script).toContain('-H 0.0.0.0');
    expect(script).not.toContain('-H 127.0.0.1');
  });

  it('verifies Dockerfile CMD points to prod:start:custom', () => {
    const dockerfile = readFileSync(DOCKERFILE_PATH, 'utf8');
    expect(dockerfile).toContain('CMD ["npm", "run", "prod:start:custom"]');
  });
});
