/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * #3510 — deploy/scripts/deploy.sh must run db:migrate, not drizzle-kit push (Finding B7).
 *
 * Finding B7: deploy.sh previously ran `push-db.mts` (drizzle-kit push) and swallowed
 * failures with `|| warn`. This bypassed the migration chain, ignored RLS policies
 * and functions, and allowed services to start on failed or broken schemas.
 *
 * deploy.sh now runs `scripts/migrate.ts --yes` and fails fast if migrations fail.
 */

const ROOT = process.cwd();
const DEPLOY_SCRIPT = join(ROOT, 'deploy', 'scripts', 'deploy.sh');

describe('deploy.sh migration safety (#3510)', () => {
  const content = readFileSync(DEPLOY_SCRIPT, 'utf8');

  it('runs scripts/migrate.ts instead of push-db.mts or drizzle-kit push', () => {
    expect(content).not.toMatch(/push-db\.mts/);
    expect(content).not.toMatch(/drizzle-kit push/);
    expect(content).toMatch(/scripts\/migrate\.ts --yes/);
  });

  it('fails fast on migration failure rather than masking with || warn', () => {
    // Should not swallow migration failure with warn
    const migrateBlockMatch = content.match(/migrate\(\)\s*\{([\s\S]*?)\n\}/);
    expect(migrateBlockMatch).not.toBeNull();
    const migrateBlock = migrateBlockMatch![1];

    expect(migrateBlock).not.toMatch(/\|\|\s*warn/);
    expect(migrateBlock).toMatch(/err\s+"Database migrations failed"/);
  });
});
