import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * CI guard for Issue #2233 (HIGH): the deploy workflow never ran DB
 * migrations and rollback was code-only, so a migration+code PR shipped new
 * code against an unmigrated schema (health gate blind to new columns) and a
 * rollback left old code on the new schema.
 *
 * deploy.yml must now: snapshot the applied migration list, take a
 * schema-only restore point (and REFUSE to migrate without one), run
 * db:migrate between checkout/RLS-gate and build, un-apply exactly what the
 * deploy added when migration fails (before any restart), and un-apply the
 * same set when the health gate fails the rollback.
 */

const WF = readFileSync(join(import.meta.dirname!, '..', '..', '.github/workflows/deploy.yml'), 'utf8');

describe('deploy.yml runs migrations + schema-aware rollback (#2233)', () => {
  it('snapshots applied migrations before migrating (rollback-migration --list)', () => {
    expect(WF).toMatch(/list_applied\(\)/);
    expect(WF).toContain('scripts/rollback-migration.ts --list');
    expect(WF).toContain('PRE_APPLIED=$(list_applied)');
    expect(WF).toContain('POST_APPLIED=$(list_applied)');
    // diff of sorted lists, newest first for un-apply order
    expect(WF).toContain('comm -13 <(echo "$PRE_APPLIED" | sort) <(echo "$POST_APPLIED" | sort) | sort -r');
  });

  it('takes a schema-only restore point and refuses to migrate without it', () => {
    expect(WF).toMatch(/pg_dump --schema-only --no-privileges --no-owner/);
    expect(WF).toContain('schema-pre-');
    expect(WF).toContain('refusing to migrate without a restore point (#2233)');
    // host pg_dump OR the container's matching client, never neither
    expect(WF).toContain('command -v pg_dump');
    expect(WF).toContain('docker exec nucrm-db pg_dump');
    // retention: keep the last 10 restore points
    expect(WF).toContain('tail -n +11 | xargs -r rm -f');
  });

  it('runs db:migrate non-interactively between the RLS gate and the build', () => {
    const rls = WF.indexOf('DB role is RLS-constrained');
    const migrate = WF.indexOf('scripts/migrate.ts --yes');
    const build = WF.indexOf('NODE_OPTIONS="--max-old-space-size=8192" npm run build');
    expect(rls).toBeGreaterThan(-1);
    expect(migrate).toBeGreaterThan(rls);
    expect(migrate).toBeLessThan(build);
    expect(WF).toContain('npx tsx --import ./scripts/load-env.mjs scripts/migrate.ts --yes');
  });

  it('migration failure un-applies only this deploy\'s tags and aborts before restart', () => {
    const failBlock = WF.slice(
      WF.indexOf('ERROR: migration failed'),
      WF.indexOf('echo "Building..."'),
    );
    expect(failBlock).toContain('for TAG in $(comm -13');
    expect(failBlock).toMatch(/rollback-migration\.ts "\$TAG" --yes/);
    expect(failBlock).toContain('exit 1');
    expect(failBlock).not.toContain('deploy_all_and_wait');
    expect(failBlock).not.toContain('pm2 restart');
  });

  it('health-gate rollback path un-applies APPLIED_NOW newest-first', () => {
    const rb = WF.slice(WF.indexOf('ERROR: app did not become healthy'));
    expect(rb).toContain('git checkout --force "$SHA"^');
    expect(rb).toContain('for TAG in $APPLIED_NOW');
    expect(rb).toMatch(/rollback-migration\.ts "\$TAG" --yes/);
    expect(rb).toContain('(deploy was unhealthy)');
  });

  it('every DB-touching CLI call loads env via the sanctioned preload', () => {
    const calls = WF.match(/npx tsx [^\n]*scripts\/(migrate|rollback-migration)\.ts[^\n]*/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const c of calls) expect(c).toContain('--import ./scripts/load-env.mjs');
  });

  it('keeps prior deploy wiring intact (RLS gate, #2300 all-apps, #2273 probe)', () => {
    expect(WF).toContain('check-db-role-privileges.mjs');
    expect(WF).toContain('BG_APPS="worker cron"');
    expect(WF).toContain('dev_server_exposed()');
    expect((WF.match(/if deploy_all_and_wait; then/g) || []).length).toBe(2);
  });
});
