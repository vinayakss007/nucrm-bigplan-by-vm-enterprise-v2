/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * #3503 — ecosystem.config.cjs must not hardcode DATABASE_SSL_REJECT_UNAUTHORIZED='false'.
 *
 * Finding B3 / #3503: PM2 apps previously hardcoded DATABASE_SSL_REJECT_UNAUTHORIZED='false'
 * for web, worker, cron, and realtime. This permanently disabled TLS certificate verification
 * in production, leaving database traffic vulnerable to MITM attacks and contradicting the
 * TLS policy in lib/db/ssl-config.ts (#3381).
 *
 * The apps now default to strict verification ('true') while allowing explicit opt-out
 * via setting('DATABASE_SSL_REJECT_UNAUTHORIZED') when running against self-signed certs.
 */

const ROOT = process.cwd();
const CONFIG_PATH = join(ROOT, 'ecosystem.config.cjs');

interface Pm2App {
  name: string;
  env?: Record<string, string>;
}

describe('ecosystem.config.cjs SSL verification (#3503)', () => {
  const configSource = readFileSync(CONFIG_PATH, 'utf8');

  it('does not hardcode DATABASE_SSL_REJECT_UNAUTHORIZED: "false"', () => {
    expect(configSource).not.toMatch(/DATABASE_SSL_REJECT_UNAUTHORIZED:\s*['"]false['"]/);
  });

  it('uses setting("DATABASE_SSL_REJECT_UNAUTHORIZED") falling back to "true"', () => {
     
    const config = require(CONFIG_PATH) as { apps: Pm2App[] };
    expect(Array.isArray(config.apps)).toBe(true);

    const appsWithDb = ['web', 'worker', 'cron', 'realtime'];
    for (const appName of appsWithDb) {
      const app = config.apps.find((a) => a.name === appName);
      expect(app, `app ${appName} must be declared`).toBeDefined();
      expect(app?.env?.DATABASE_SSL).toBe('true');
      expect(app?.env?.DATABASE_SSL_REJECT_UNAUTHORIZED).toBe('true');
    }
  });
});
