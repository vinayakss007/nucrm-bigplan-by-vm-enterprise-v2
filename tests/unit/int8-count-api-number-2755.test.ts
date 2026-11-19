/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2755 — PostgreSQL COUNT(*) is int8; node-postgres returns int8 as a STRING
 * (this repo has no pg.setTypeParser). Any `sql<number>` count whose result is
 * placed straight into a JSON response must carry `::int`. This pins the two
 * remaining offenders after the dead-letter fix (#3646):
 *   - admin tenant-restore `backupCount` (scalar subquery COUNT(*))
 *   - superadmin stats `platformUsage.{active,trialing,suspended}` (COUNT FILTER)
 *
 * Asserts on source so dropping a cast again turns CI red rather than silently
 * changing the response type.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '..', '..');
const source = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('int8 counts in typed JSON responses carry ::int (#2755)', () => {
  it('admin tenant-restore backupCount is cast', () => {
    const src = source('app/api/admin/tenant-restore/route.ts');
    expect(src).toMatch(/sql<number>`\(SELECT COUNT\(\*\)::int FROM tenant_backup_records/);
  });

  it('superadmin stats platformUsage counts are all cast', () => {
    const src = source('app/api/superadmin/stats/route.ts');
    for (const status of ['active', 'trialing', 'suspended']) {
      expect(src, `${status} COUNT FILTER is not cast to int`).toMatch(
        new RegExp(`COUNT\\(\\*\\) FILTER \\(WHERE \\$\\{tenants\\.status\\} = '${status}'\\)::int`),
      );
    }
  });

  it('the safe Number()-wrapped and display-only outliers are left alone', () => {
    // SCIM wraps the uncast count at its response boundary; telegram counts are
    // only interpolated into a reply string. Neither is a typed JSON number.
    const scim = source('app/api/scim/v2/Users/route.ts');
    expect(scim).toMatch(/Number\(countResult\?\.count \?\? 0\)/);
  });
});
