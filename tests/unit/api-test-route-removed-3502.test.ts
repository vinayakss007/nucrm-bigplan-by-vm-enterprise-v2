/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * #3502: Remove unauthenticated leftover debug route app/api/test/route.ts
 *
 * `app/api/test/route.ts` was an unauthenticated leftover debug echo route
 * that returned `{ status: 'ok', message: 'CRM API is running' }` without
 * tenant isolation, authentication, or rate limiting.
 *
 * Production liveness probes are answered by `/api/health` and `/api/healthz`.
 * No unauthenticated debug echo routes should exist on the production surface.
 */

const ROOT = process.cwd();

describe('leftover debug route removal (#3502)', () => {
  it('ensures app/api/test/route.ts does not exist', () => {
    const routePath = join(ROOT, 'app', 'api', 'test', 'route.ts');
    expect(existsSync(routePath)).toBe(false);
  });

  it('ensures app/api/test directory does not exist', () => {
    const dirPath = join(ROOT, 'app', 'api', 'test');
    expect(existsSync(dirPath)).toBe(false);
  });
});
