/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3298 ask 2 — `guard:cron-auth` over every cron route.
 *
 * The behaviour is pinned in cron-task-reminders.test.ts (a real allowlist denial
 * through the real lib/auth/cron). This spec pins the guarantee that keeps the
 * other twenty-one routes from drifting back: every `app/api/cron/**\/route.ts`
 * authenticates through `verifyCronSecret`, names its job in the denial record, and
 * the exemption baseline cannot rot into a blanket pardon.
 *
 * Each case plants one problem in a throwaway tree, because a guard that has never
 * been seen to fail is not evidence of anything. The last case runs against the
 * real tree — that is what makes the screen a check rather than a description.
 *
 * Enforced from `test-unit` (this spec shells out to the script) in addition to the
 * `pre-merge-check.sh` step the issue asks for, so CI fails a regression on the
 * branch that introduced it instead of on the next deploy.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const ROOT = join(import.meta.dirname!, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-cron-auth.mjs');

const CRON_MODULE = `
export async function checkCronAuth(req, rawBody) { return { ok: true, reason: 'ok' }; }
function auditCronAuth(jobName, result, ip) {
  if (result.ok) return;
  void (async () => {
    const { logError } = await import('@/lib/errors-server');
    await logError({ error: new Error(jobName), context: 'cron-auth', level: 'warning',
      metadata: { job: jobName, reason: result.reason, ip: ip ?? 'unknown' } });
  })();
}
export async function verifyCronSecret(req, opts) {
  const result = await checkCronAuth(req, opts?.rawBody);
  auditCronAuth(opts?.job ?? 'unknown', result, getTrustedIp(req));
  return result.ok;
}
`;

const CONVERTED = (job: string) => `
import { verifyCronSecret } from '@/lib/auth/cron';
export async function POST(request) {
  if (!await verifyCronSecret(request, { job: '${job}' })) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return run('${job}');
}
`;

// The shape twenty of the twenty-two routes shipped: the header compared to
// CRON_SECRET by hand, so layers 1-2 and the denial record never ran.
const BYPASSING = `
import { verifySecret } from '@/lib/crypto';
export async function POST(request) {
  if (!verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return run();
}
`;

// Converted, but without a job name: the denial record reads `job: 'unknown'`,
// which is the difference between an allowlist that is not being honoured showing
// up in the log pipeline and looking like a working configuration (#3253).
const UNNAMED = `
import { verifyCronSecret } from '@/lib/auth/cron';
export async function POST(request) {
  if (!await verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return run();
}
`;

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'cron-auth-3298-'));
  for (const [rel, text] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return dir;
}

const tree = (routes: Record<string, string>, extra: Record<string, string> = {}) => fixture({
  'lib/auth/cron.ts': CRON_MODULE,
  ...Object.fromEntries(Object.entries(routes).map(([name, src]) => [`app/api/cron/${name}/route.ts`, src])),
  ...extra,
});

function run(cwd: string) {
  return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' });
}

describe('check-cron-auth.mjs fails what it claims (#3298 ask 2)', () => {
  it('fails a route that compares the secret by hand', () => {
    const res = run(tree({ 'task-reminders': CONVERTED('task-reminders'), cleanup: BYPASSING }));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('app/api/cron/cleanup/route.ts');
    expect(res.stderr).toContain('verifyCronSecret');
  });

  it('passes a tree where every route goes through the shared check', () => {
    const res = run(tree({ 'task-reminders': CONVERTED('task-reminders'), cleanup: CONVERTED('cleanup') }));
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain('2 cron route(s)');
  });

  it('fails a converted route that forgets to name its job, so the denial record says "unknown"', () => {
    const res = run(tree({
      'task-reminders': CONVERTED('task-reminders'),
      'sla-check': UNNAMED,
    }));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('app/api/cron/sla-check/route.ts');
    expect(res.stderr).toContain('job');
  });

  it('fails when the denial record stops naming the reason or the source', () => {
    const res = run(tree(
      { 'task-reminders': CONVERTED('task-reminders') },
      { 'lib/auth/cron.ts': CRON_MODULE.replace('metadata: { job: jobName, reason: result.reason, ip: ip ?? \'unknown\' }', 'metadata: { job: jobName }') },
    ));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('reason');
  });

  it('fails an exemption that carries no written reason, and a stale one naming a route that no longer needs it', () => {
    const noReason = run(tree(
      { 'task-reminders': CONVERTED('task-reminders'), cleanup: BYPASSING },
      { 'scripts/cron-auth-exempt.json': JSON.stringify([{ path: 'app/api/cron/cleanup/route.ts', reason: '' }]) },
    ));
    expect(noReason.status).toBe(1);
    expect(noReason.stderr).toContain('reason');

    const stale = run(tree(
      { 'task-reminders': CONVERTED('task-reminders'), cleanup: CONVERTED('cleanup') },
      { 'scripts/cron-auth-exempt.json': JSON.stringify([{ path: 'app/api/cron/task-reminders/route.ts', reason: 'fixed ages ago' }]) },
    ));
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain('stale');
  });

  it('honours an exemption that states its reason', () => {
    const res = run(tree(
      { 'task-reminders': CONVERTED('task-reminders'), cleanup: BYPASSING },
      { 'scripts/cron-auth-exempt.json': JSON.stringify([{ path: 'app/api/cron/cleanup/route.ts', reason: 'dual-mode route: superadmin session is an accepted credential here' }]) },
    ));
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain('1 exempted');
  });

  it('fails when the scan finds no cron route at all, instead of printing OK', () => {
    // A moved directory would otherwise turn this guard into a green light.
    const res = run(fixture({ 'lib/auth/cron.ts': CRON_MODULE }));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('found no cron route');
  });

  it('runs on the real tree: 22 routes, all converted, no exemptions', () => {
    const res = run(ROOT);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain('22 cron route(s)');
    expect(res.stdout).toContain('0 exempted');
  });
});
