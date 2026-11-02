/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a sent email is a result, not a hope.
 *
 * `sendEmail()` never rejects: every provider path resolves `{success:false}`
 * (lib/email/service.ts). So `await sendEmail(…).catch(log)` is a handler for a
 * throw that cannot happen, and a bare `await alertSuperAdmin(…)` throws the
 * rejection away with no handler at all. #2998, #3045 and #3110 are three prior
 * visits to that hole at three separate call sites; the one still standing was
 * the super-admin alert channel — the message whose entire job is to page someone
 * about a broken backup, silent about its own failure.
 *
 * What is under test:
 *   - scripts/check-email-result-consumed.mjs  (`node scripts/check-email-result-consumed.mjs`)
 *   - lib/email/service.ts `alertSuperAdmin`   — the choke point every alert path crosses
 *   - lib/email/alerts.ts  `sendAlertEmail`    — the pass-through wrapper
 *   - the ten call sites in the backup routes that used to end in a dead `.catch()`
 *
 * The screen is deliberately NOT a `guard:*` alias: adding one moves the guard
 * census in docs/README.md that #3398 and #3399 are already arguing about, so it
 * rides `npm run test:unit` the way `guard:migration-redecl` and #3413's scripts
 * typecheck do.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  SEND_FNS,
  matchParen,
  findCalls,
  classifySource,
  run,
} from '../../scripts/check-email-result-consumed.mjs';

const ROOT = join(import.meta.dirname!, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-email-result-consumed.mjs');

const logErrorMock = vi.fn(async () => {});
const loggerError = vi.fn();

vi.mock('@/lib/errors-server', () => ({ logError: logErrorMock }));
vi.mock('@/lib/logger', () => ({
  logger: { error: loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/** A source snippet with the call the screen is being asked about. */
const src = (body: string) => `import { sendEmail, alertSuperAdmin, sendAlertEmail } from '@/lib/email/service';\nexport async function f() {\n${body}\n}\n`;

function kinds(body: string) {
  return classifySource(src(body), 'fixture.ts').findings.map((x: { kind: string }) => x.kind);
}

describe('#3408 the contract that makes a .catch() dead', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('resolves {success:false} rather than rejecting when no provider is configured', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    const { sendEmail } = await import('@/lib/email/service');
    const result = await sendEmail({ to: 'ops@example.test', subject: 's', html: '<p>h</p>' });
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/provider/i);
  });

  it('a .catch() attached to that call is never entered — the shape the screen rejects', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    const { sendEmail } = await import('@/lib/email/service');
    const handler = vi.fn();
    await sendEmail({ to: 'ops@example.test', subject: 's', html: '<p>h</p>' }).catch(handler);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('#3408 alertSuperAdmin reads the result it used to drop', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('returns the provider failure to the caller instead of swallowing it', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SUPER_ADMIN_EMAIL = 'admin@example.test';
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    const { alertSuperAdmin } = await import('@/lib/email/service');
    const result = await alertSuperAdmin('CRITICAL: Backup verification FAILED', 'no pg_dump on the box');
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/provider/i);
  });

  it('says so in the log — the alert channel is no longer silent about its own failure', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SUPER_ADMIN_EMAIL = 'admin@example.test';
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    const { alertSuperAdmin } = await import('@/lib/email/service');
    await alertSuperAdmin('CRITICAL: Automated Database Backup FAILED', 'disk full');
    const call = loggerError.mock.calls.find((c) => String(c[0]).includes('alert NOT delivered'));
    expect(call, `expected an "alert NOT delivered" log, got ${JSON.stringify(loggerError.mock.calls)}`).toBeDefined();
    expect((call![1] as { subject: string }).subject).toBe('CRITICAL: Automated Database Backup FAILED');
  });

  it('a missing SUPER_ADMIN_EMAIL is a failed alert, not a successful no-op', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SUPER_ADMIN_EMAIL;
    const { alertSuperAdmin } = await import('@/lib/email/service');
    const result = await alertSuperAdmin('WARNING: No backup in 30 hours', 'check the cron');
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/SUPER_ADMIN_EMAIL/);
  });

  it('a delivered alert reports success, so a caller can branch on it', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SUPER_ADMIN_EMAIL = 'admin@example.test';
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    const { alertSuperAdmin } = await import('@/lib/email/service');
    await expect(alertSuperAdmin('Alert', 'body')).resolves.toMatchObject({ success: true });
  });

  it('sendAlertEmail passes the result through instead of dropping it', async () => {
    vi.resetModules();
    vi.doMock('@/lib/email/service', () => ({
      alertSuperAdmin: vi.fn(async () => ({ success: false, error: 'provider rejected the message' })),
    }));
    const { sendAlertEmail } = await import('@/lib/email/alerts');
    await expect(sendAlertEmail('Auto-backup incomplete', '2 tenants skipped')).resolves.toMatchObject({ success: false });
    vi.doUnmock('@/lib/email/service');
  });
});

describe('#3408 the screen accepts every shape that reads the result', () => {
  it.each([
    ['bound', "const r = await sendEmail({ to: 'a@b.c', subject: 's', html: 'h' });\nif (!r.success) log(r.error);"],
    ['bound without await', "const r = sendEmail({ to: 'a@b.c' });"],
    ['returned', "return sendEmail({ to: 'a@b.c' });"],
    ['returned through await', "return await alertSuperAdmin('s', 'm');"],
    ['checked in .then', "void sendEmail({ to: 'a@b.c', subject: 's' })\n      .then((result) => { if (!result.success) warn(result.error); });"],
    ['field read off the awaited value', "const ok = (await sendAlertEmail('s', 'm')).success;"],
    ['passed as an argument', "expect(alertSuperAdmin('s', 'm')).toBeDefined();"],
    ['arrow body', "const send = () => sendEmail({ to: 'a@b.c' });"],
  ])('%s', (_label, body) => {
    expect(kinds(body)).toEqual([]);
  });

  it('does not count a definition, an import or a sentence that mentions the name', () => {
    const source = [
      "import { sendEmail } from '@/lib/email/service';",
      'export async function sendEmail(payload: EmailPayload): Promise<SendResult> {',
      '  // sendEmail( is the only writer of this result',
      '  return { success: true };',
      '}',
    ].join('\n');
    expect(findCalls(source)).toHaveLength(0);
    expect(classifySource(source, 'svc.ts').findings).toEqual([]);
  });
});

describe('#3408 the screen bites what it is for', () => {
  it('a bare await that drops {success:false}', () => {
    expect(kinds("await alertSuperAdmin('CRITICAL: Backup FAILED', 'disk full');")).toEqual(['unbound']);
  });

  it('a .catch() handler that can never fire', () => {
    expect(kinds("await sendEmail({ to: 'a@b.c' }).catch((err) => logError(err));")).toEqual(['dead-catch']);
  });

  it('the exact shape the backup routes shipped', () => {
    const body = [
      "      await alertSuperAdmin(",
      "        'WARNING: Database backup did not reach off-site storage',",
      "        `The only copy is at ${localPath} on the application host`",
      "      ).catch((err) => logError({ error: err }));",
    ].join('\n');
    expect(kinds(body)).toEqual(['dead-catch']);
  });

  it('a call it cannot parse is a finding, not a silence', () => {
    // A string containing a paren is NOT unparseable (the first test of that
    // shape proved the scanner right and the fixture wrong); an unterminated
    // call is, and must fail closed rather than count as checked.
    const findings = classifySource(src("  await sendEmail({ to: 'a@b.c'"), 'broken.ts').findings;
    expect(findings.map((f: { kind: string }) => f.kind)).toEqual(['unparsable']);
  });

  it('a paren inside an HTML template does not fool the scanner', () => {
    const body = "const r = await sendEmail({ to: 'a@b.c', html: '<p style=\"rgba(0, 0, 0, .5)\">(only one)</p>' });\nif (!r.success) warn(r.error);";
    expect(classifySource(src(body), 'ok.ts').findings).toEqual([]);
  });

  it('reads a real multi-line HTML template without losing the closing paren', () => {
    const body = [
      'const r = await sendEmail({',
      "  to: 'ops@example.test',",
      "  subject: `Size: ${bytes ? (bytes / 1024 / 1024).toFixed(1) + 'MB' : 'unknown'}`,",
      "  html: `<div style=\"background: rgba(0, 0, 0, 0.5)\">",
      '    <p>Copy is at ${localPath} (the only one)</p>',
      "  </div>`,",
      '});',
      "if (!r.success) warn(r.error);",
    ].join('\n');
    expect(findCalls(src(body))).toHaveLength(1);
    expect(classifySource(src(body), 'tpl.ts').findings).toEqual([]);
  });

  it('matchParen ignores parens inside strings and template holes', () => {
    const source = "f('a(b', `x ${ '(y' } c)`, ')')";
    const open = source.indexOf('(');
    expect(source[matchParen(source, open)]).toBe(')');
    expect(matchParen(source, open)).toBe(source.length - 1);
  });

  it('names every helper it watches', () => {
    expect(SEND_FNS).toEqual(['sendEmail', 'alertSuperAdmin', 'sendAlertEmail']);
  });
});

describe('#3408 the real tree', () => {
  it('has no send call whose result is dropped or .catch()-masked', () => {
    const { findings, checked } = run(ROOT);
    expect(findings.map((f: { path: string; line: number; why: string }) => `${f.path}:${f.line} ${f.why}`)).toEqual([]);
    // Floor, not an equality: the point is that the screen is actually looking at
    // the estate (29 sendEmail sites + the alert wrappers), not that it counts a
    // number nobody re-measured.
    expect(checked).toBeGreaterThanOrEqual(37);
  });

  it('the nine alert call sites that used to end in a dead .catch() now bind the result', () => {
    const files = [
      'app/api/cron/backup/route.ts',
      'app/api/cron/backup-health/route.ts',
      'app/api/cron/backup-verify/route.ts',
      'app/api/cron/auto-backup/route.ts',
      'lib/backups/backup-service.ts',
    ];
    const pattern = /(?:const|let)\s+\w+\s*=\s*await\s+(?:alertSuperAdmin|sendAlertEmail)\(/g;
    const seen = files
      .flatMap((rel) => (read(rel).match(pattern) ?? []).map((m) => `${rel}: ${m}`))
      .filter((s) => /alertSuperAdmin|sendAlertEmail/.test(s));
    expect(seen.length).toBe(9);
    for (const rel of files) {
      expect(read(rel), `${rel} still .catch()-es a send that cannot reject`).not.toMatch(/\)\s*\.catch\b[^;]*alert/i);
    }
  });

  it('the welcome-email action records an undelivered send', () => {
    const body = read('lib/automation/workflows.ts');
    expect(body).toMatch(/const sent = await sendEmail\(/);
    expect(body).toMatch(/if \(!sent\.success\)/);
  });

  function read(rel: string): string {
    return readFileSync(join(ROOT, rel), 'utf8');
  }
});

describe('#3408 the screen runs as a command', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'email-result-'));
    mkdirSync(join(dir, 'lib'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits 1 with the file and line on a planted discard', () => {
    writeFileSync(
      join(dir, 'lib', 'caller.ts'),
      "import { sendEmail } from '@/lib/email/service';\nexport async function f() {\n  await sendEmail({ to: 'a@b.c', subject: 's', html: 'h' });\n}\n",
    );
    const r = spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('lib/caller.ts:3');
    expect(r.stderr).toMatch(/is discarded/);
  });

  it('exits 0 on a tree that binds every result', () => {
    writeFileSync(
      join(dir, 'lib', 'caller.ts'),
      "import { sendEmail } from '@/lib/email/service';\nexport async function f() {\n  const r = await sendEmail({ to: 'a@b.c', subject: 's', html: 'h' });\n  return r.success;\n}\n",
    );
    const r = spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/OK — 1 send call\(s\)/);
  });
});
