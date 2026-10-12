import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';

/**
 * CI guard for Issue #2233 (HIGH) and its follow-up.
 *
 * #2233: the deploy workflow never ran DB migrations, so a migration+code PR
 * shipped new code against an unmigrated schema while the health gate stayed
 * green. PR #2376 fixed that by writing ~70 lines of bash into the SSH heredoc:
 * it scraped `rollback-migration.ts --list` stdout with awk, parsed
 * .env.local with an inline node regex, dumped a schema restore point into
 * /tmp and pruned it with `ls -t | tail -n +11 | xargs rm -f`, guessed the
 * container topology with `docker exec nucrm-db`, and un-applied migrations on
 * failure despite .kiro/steering/global-standards.md §6.3 ("forward-only,
 * rollbacks are separate scripts").
 *
 * That logic now lives in scripts/deploy-migrate.ts + lib/db/deploy-migration-
 * run.ts, where it is type-checked and behaviour-tested
 * (tests/unit/deploy-migration-run.test.ts). What THIS file pins is the
 * workflow's side of the deal: it delegates, it gates, and it contains none of
 * the inline shell that made the old version untestable — in particular no
 * command that deletes a backup or restore point.
 */

const ROOT = join(import.meta.dirname!, '..', '..');
const WF = readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
const BACKUP_SCRIPT = readFileSync(join(ROOT, 'scripts', 'backup-db.ts'), 'utf8');

/**
 * WF with comment lines removed. The prose in deploy.yml deliberately names the
 * techniques this test forbids (`awk`, `ls -t`, un-apply) so the next reader
 * knows why they are gone — so the negative pins run against the commands that
 * actually execute, never against the explanation of them.
 */
const WF_CODE = WF
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

describe('deploy.yml delegates migration to the tested script (#2233)', () => {
  it('calls scripts/deploy-migrate.ts --yes through the sanctioned env preload', () => {
    expect(WF).toContain('npx tsx --import ./scripts/load-env.mjs scripts/deploy-migrate.ts --yes');
    // DEPLOY_SHA is passed so the restore point names the commit it protects.
    expect(WF).toMatch(/DEPLOY_SHA="\$SHA" npx tsx/);
  });

  it('migrates after the RLS role gate and before the build or any restart', () => {
    const rls = WF.indexOf('DB role is RLS-constrained');
    const migrate = WF.indexOf('scripts/deploy-migrate.ts --yes');
    const build = WF.indexOf('NODE_OPTIONS="--max-old-space-size=8192" npm run build');
    const firstGate = WF.indexOf('if deploy_all_and_wait; then');

    expect(rls).toBeGreaterThan(-1);
    expect(migrate).toBeGreaterThan(rls);
    expect(migrate).toBeLessThan(build);
    expect(migrate).toBeLessThan(firstGate);
  });

  it('a non-zero migrate exit aborts before anything is built or restarted', () => {
    const block = WF.slice(
      WF.indexOf('scripts/deploy-migrate.ts --yes'),
      WF.indexOf('echo "Schema is current'),
    );
    expect(block).toContain('exit 1');
    expect(block).not.toContain('deploy_all_and_wait');
    expect(block).not.toContain('pm2 restart');
  });

  it('keeps prior deploy wiring intact (RLS gate, #2300 all-apps, #2273 probe)', () => {
    expect(WF_CODE).toContain('check-db-role-privileges.mjs');
    expect(WF_CODE).toContain('BG_APPS="worker cron"');
    expect(WF_CODE).toContain('dev_server_exposed(');
    expect((WF_CODE.match(/if deploy_all_and_wait; then/g) || []).length).toBe(2);
  });

  it('is still valid YAML and the deploy step still carries the script', () => {
    const doc = YAML.parse(WF);
    const step = doc.jobs.deploy.steps.find(
      (s: { name?: string }) => s?.name === 'Deploy via SSH',
    );
    expect(step.with.script).toContain('scripts/deploy-migrate.ts --yes');
    expect(typeof step.with.command_timeout).toBe('string');
  });
});

describe('deploy.yml contains no inline DB plumbing (#2233 follow-up)', () => {
  // Each of these was present in the #2376 heredoc and is now either a typed
  // call in lib/db/deploy-migration-run.ts or gone entirely.
  it('never scrapes human-readable CLI output for state', () => {
    expect(WF_CODE).not.toMatch(/\bawk\b/);
    expect(WF_CODE).not.toContain('comm -13');
    expect(WF_CODE).not.toMatch(/rollback-migration\.ts --list/);
  });

  it('never re-parses .env.local for DATABASE_URL', () => {
    expect(WF_CODE).not.toMatch(/node -e .*DATABASE_URL/);
    expect(WF_CODE).not.toContain('readFileSync(".env.local"');
  });

  it('never runs pg_dump itself, on the host or via a guessed container', () => {
    expect(WF_CODE).not.toContain('pg_dump');
    expect(WF_CODE).not.toMatch(/docker exec \S+ pg_dump/);
  });

  it('never calls migrate.ts or rollback-migration.ts directly — the script owns both', () => {
    expect(WF_CODE).not.toMatch(/npx tsx[^\n]*scripts\/migrate\.ts/);
    expect(WF_CODE).not.toMatch(/scripts\/rollback-migration\.ts/);
  });

  it('is forward-only: no automatic un-apply anywhere in the workflow (§6.3)', () => {
    const rollbackPath = WF_CODE.slice(WF_CODE.indexOf('ERROR: app did not become healthy'));
    expect(rollbackPath).toContain('git checkout --force "$SHA"^');
    expect(rollbackPath).not.toMatch(/for TAG in/);
    expect(rollbackPath).not.toMatch(/rollback-migration/);
    // The intent is documented, not merely implied by the absence.
    expect(WF).toMatch(/Rollback is CODE-ONLY/);
    expect(WF).toMatch(/forward-only/i);
  });
});

describe('backup deletion policy (#2233 follow-up)', () => {
  it('the deploy workflow deletes no backup or restore point', () => {
    expect(WF_CODE).not.toMatch(/xargs -r rm/);
    expect(WF_CODE).not.toMatch(/rm -f[^\n]*(schema-pre|backup|restore)/);
    expect(WF_CODE).not.toMatch(/ls -t/);
  });

  it('the nightly backup script creates and uploads; it never unlinks', () => {
    expect(BACKUP_SCRIPT).not.toContain('unlinkSync');
    expect(BACKUP_SCRIPT).not.toContain('deleteOldBackups');
    expect(BACKUP_SCRIPT).toMatch(/never deleted|never auto-deleted/i);
  });

  it('offsite expiry keeps critical data for at least two years', async () => {
    const { MIN_RETENTION_DAYS, DEFAULT_RETENTION, applyRetentionPolicy } = await import(
      '@/lib/backups/retention-policy'
    );
    expect(MIN_RETENTION_DAYS).toBeGreaterThanOrEqual(730);
    expect(DEFAULT_RETENTION.minAgeDays).toBe(MIN_RETENTION_DAYS);

    // A same-day burst of restore points — the case the old count-based prune
    // destroyed — must survive the policy untouched.
    const now = new Date('2026-10-06T04:00:00Z');
    const burst = Array.from({ length: 12 }, (_, i) => ({
      key: `backups/schema-pre-${i}.dump`,
      createdAt: new Date(now.getTime() - i * 3_600_000),
    }));
    const decision = applyRetentionPolicy(burst, DEFAULT_RETENTION, now);
    expect(decision.delete).toHaveLength(0);
    expect(decision.keep).toHaveLength(12);
  });
});
