/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3572 — the deep health endpoint must read the migration ledger from the
 * schema that owns it. The unqualified name resolved to public under the
 * deployment's `search_path`, so the query threw on every request and the
 * endpoint reported `migration.status: 'unknown'` forever.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url).pathname, 'utf8');
const ROUTE = read('app/api/system/health/route.ts');
const MIGRATE = read('scripts/migrate.ts');
const STATUS = read('scripts/migration-status.ts');
const INIT = read('deploy/postgres/init.sql');

describe('#3572 the health endpoint reads the real migration ledger', () => {
  it('qualifies the ledger with the drizzle schema', () => {
    expect(ROUTE).toContain('FROM "drizzle"."__drizzle_migrations"');
    expect(ROUTE).not.toMatch(/FROM "__drizzle_migrations"/);
  });

  it('the qualified name is the one the migrator and status reader use', () => {
    expect(MIGRATE).toContain('"drizzle"."__drizzle_migrations"');
    expect(STATUS).toContain('"drizzle"."__drizzle_migrations"');
    // ...and public really is the default search path, so the old name could
    // never have resolved on a correctly provisioned database.
    expect(INIT).toMatch(/SET search_path TO public/);
  });

  it('keeps the migration block of the health response intact', () => {
    expect(ROUTE).toContain('health.migration = {');
    expect(ROUTE).toContain('currentVersion: vResult.rows[0]?.version');
    expect(ROUTE).toContain("health.migration = { currentVersion: null, status: 'unknown' }");
  });
});
