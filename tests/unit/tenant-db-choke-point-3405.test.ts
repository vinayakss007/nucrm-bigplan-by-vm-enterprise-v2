/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3405 — the tenant GUC has no choke point, so the screen has to hold the line.
 *
 * `app.current_tenant` is ambient state on a pooled connection: a statement that
 * runs before it is set answers zero rows instead of failing, which is why every
 * fix to this class (#3316, #3315, #3312, #3290, #3288, #3197, #3196, #3195,
 * #3102, #2787, #2626, #2468, #3303) was a call-site patch and why the class
 * keeps coming back. PR-3A's branded `TenantDb` is the fix and it touches 522
 * files, so it cannot land in one reviewable commit.
 *
 * `scripts/check-tenant-db-context.mjs` is what stops the surface growing while
 * that refactor happens: an exact-set ledger — not a count — so a migrated file
 * leaves a stale entry that fails, and a new file cannot hide behind another
 * file's removal. These tests pin the properties that make it a ratchet rather
 * than a baseline:
 *
 *   - the repo's own ledger matches the repo exactly, right now (the assertion
 *     that goes red the moment someone adds an import and does not look);
 *   - every entry argues why that area may still hold the raw client, and names
 *     the issue that carries it;
 *   - an unlisted file, a stale entry, a short reason, a leftover `--update`
 *     placeholder and a non-issue `filedAs` each fail, by code;
 *   - `import type` is not a leak (it is erased) and `lib/db/**` is exempt (it
 *     *is* the choke point).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = join(import.meta.dirname!, '..', '..', 'scripts', 'check-tenant-db-context.mjs');
const ROOT = join(import.meta.dirname!, '..', '..');

const {
  check,
  buildLedger,
  evaluateLedger,
  groupOf,
  importsRawClient,
  scanRepo,
  MIN_REASON_LENGTH,
} = await import(SCRIPT);

const LONG_REASON = 'kept for #3405 PR-3A: this area binds its own tenant before every read, see the entry note';

/** A throwaway tree shaped like the scanned roots. */
function fixture(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'tenant-db-3405-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}

function run(args: string[], cwd: string) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('what counts as reaching the raw client (#3405)', () => {
  it('sees every spelling that can open a connection', () => {
    const forms = [
      "import { db } from '@/drizzle/db';",
      "import db from '@/drizzle/db';",
      "import * as raw from '@/drizzle/db';",
      "import { db } from '../../drizzle/db';",
      "import '@/drizzle/db';",
      "export { db } from '@/drizzle/db';",
    ];
    for (const form of forms) {
      expect(importsRawClient(form), form).toHaveLength(1);
    }
  });

  it('does not count a type import, which the compiler erases', () => {
    expect(importsRawClient("import type { Database } from '@/drizzle/db';")).toEqual([]);
  });

  it('does not count the choke point own helper surface', () => {
    expect(importsRawClient("import { withTenantContext } from '@/lib/db/rls';")).toEqual([]);
    expect(importsRawClient("import { contacts } from '@/drizzle/schema';")).toEqual([]);
  });

  it('reports the offending statement, not just a boolean', () => {
    const found = importsRawClient("import { sql } from 'drizzle-orm';\nimport { db } from '@/drizzle/db';");
    expect(found[0]).toContain('@/drizzle/db');
  });
});

describe('the scan scope (#3405)', () => {
  it('walks the roots, skips lib/db, node_modules and test files', () => {
    const dir = fixture({
      'app/api/tenant/deals/route.ts': "import { db } from '@/drizzle/db';",
      'lib/db/index.ts': "import { Pool } from 'pg';",
      'lib/ai/client.ts': "import { db } from '@/drizzle/db';",
      'lib/ai/client.test.ts': "import { db } from '@/drizzle/db';",
      'node_modules/pkg/index.ts': "import { db } from '@/drizzle/db';",
      'worker.ts': "import { db } from '@/drizzle/db';",
    });
    try {
      const offenders = scanRepo({ root: dir, roots: ['app', 'lib', 'worker.ts'] });
      expect(offenders.map((o: { file: string }) => o.file)).toEqual([
        'app/api/tenant/deals/route.ts',
        'lib/ai/client.ts',
        'worker.ts',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('groups a route by its API area so one argued entry covers it', () => {
    expect(groupOf('app/api/tenant/deals/route.ts')).toBe('app/api/tenant');
    expect(groupOf('app/api/superadmin/tenants/[id]/route.ts')).toBe('app/api/superadmin');
    expect(groupOf('lib/ai/tools/score.ts')).toBe('lib/ai');
    expect(groupOf('worker.ts')).toBe('worker.ts');
  });
});

describe('the ledger is an exact set, not a ceiling (#3405)', () => {
  const offender = { file: 'lib/ai/client.ts', imports: ["import { db } from '@/drizzle/db'"] };

  it('passes when the listed files are exactly the scanned files', () => {
    const ledger = { groups: { 'lib/ai': { reason: LONG_REASON, filedAs: '#3405', files: ['lib/ai/client.ts'] } } };
    expect(evaluateLedger([offender], ledger).ok).toBe(true);
  });

  it('fails a new import nobody admitted', () => {
    const ledger = { groups: { 'lib/ai': { reason: LONG_REASON, filedAs: '#3405', files: ['lib/ai/other.ts'] } } };
    const result = evaluateLedger([offender], ledger);
    const codes = result.findings.map((f: { code: string }) => f.code);
    expect(codes).toContain('unlisted-file');
    expect(codes).toContain('stale-entry');
    expect(result.ok).toBe(false);
    const unlisted = result.findings.find((f: { code: string }) => f.code === 'unlisted-file');
    expect(unlisted.message).toContain('lib/ai/client.ts');
  });

  it('fails a stale entry, which is what makes the list ratchet down', () => {
    const ledger = {
      groups: {
        'lib/ai': { reason: LONG_REASON, filedAs: '#3405', files: ['lib/ai/client.ts', 'lib/ai/migrated.ts'] },
      },
    };
    const findings = evaluateLedger([offender], ledger).findings;
    expect(findings.map((f: { code: string }) => f.code)).toEqual(['stale-entry']);
    expect(findings[0].message).toContain('lib/ai/migrated.ts');
  });

  it('fails a reason that is a label rather than an argument', () => {
    const ledger = { groups: { 'lib/ai': { reason: 'legacy', filedAs: '#3405', files: ['lib/ai/client.ts'] } } };
    const findings = evaluateLedger([offender], ledger).findings;
    expect(findings.map((f: { code: string }) => f.code)).toEqual(['missing-reason']);
    expect(findings[0].message).toContain(String(MIN_REASON_LENGTH));
  });

  it('fails an unreviewed --update placeholder', () => {
    const ledger = {
      groups: {
        'lib/ai': {
          reason: 'TODO: this area is not yet bound to a tenant context (#3405 PR-3A).',
          filedAs: '#3405',
          files: ['lib/ai/client.ts'],
        },
      },
    };
    expect(evaluateLedger([offender], ledger).findings.map((f: { code: string }) => f.code)).toEqual([
      'unreviewed-reason',
    ]);
  });

  it('fails an entry that does not name the issue carrying it', () => {
    for (const filedAs of ['3405', 'later', '']) {
      const ledger = { groups: { 'lib/ai': { reason: LONG_REASON, filedAs, files: ['lib/ai/client.ts'] } } };
      expect(evaluateLedger([offender], ledger).findings.map((f: { code: string }) => f.code)).toEqual([
        'missing-filed-as',
      ]);
    }
  });
});

describe('--update keeps the argument a human already wrote (#3405)', () => {
  it('groups by area and preserves the reviewed reason across regeneration', () => {
    const previous = {
      groups: { 'lib/ai': { reason: LONG_REASON, filedAs: '#3405', files: ['lib/ai/client.ts'] } },
    };
    const ledger = buildLedger(
      [
        { file: 'lib/ai/client.ts', imports: ['x'] },
        { file: 'lib/ai/tools/score.ts', imports: ['x'] },
        { file: 'app/api/tenant/deals/route.ts', imports: ['x'] },
      ],
      previous,
    );
    expect(Object.keys(ledger.groups).sort()).toEqual(['app/api/tenant', 'lib/ai']);
    expect(ledger.groups['lib/ai'].reason).toBe(LONG_REASON);
    expect(ledger.groups['lib/ai'].files).toEqual(['lib/ai/client.ts', 'lib/ai/tools/score.ts']);
    // A group the human has not argued yet stays red until they do.
    expect(evaluateLedger([{ file: 'app/api/tenant/deals/route.ts', imports: ['x'] }], ledger)
      .findings.map((f: { code: string }) => f.code)).toContain('unreviewed-reason');
  });
});

describe('the CLI answers with an exit code a workflow can gate on (#3405)', () => {
  it('exits 0 on a tree whose ledger is exact', () => {
    const dir = fixture({
      'app/api/tenant/deals/route.ts': "import { db } from '@/drizzle/db';",
      'scripts/tenant-db-ledger.json': JSON.stringify({
        groups: {
          'app/api/tenant': { reason: LONG_REASON, filedAs: '#3405', files: ['app/api/tenant/deals/route.ts'] },
        },
      }),
    });
    try {
      const result = run([], dir);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('OK');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 1 and names the file when a new route imports the pool', () => {
    const dir = fixture({
      'app/api/tenant/deals/route.ts': "import { db } from '@/drizzle/db';",
      'app/api/tenant/deals/new-route.ts': "import { db } from '@/drizzle/db';",
      'scripts/tenant-db-ledger.json': JSON.stringify({
        groups: {
          'app/api/tenant': { reason: LONG_REASON, filedAs: '#3405', files: ['app/api/tenant/deals/route.ts'] },
        },
      }),
    });
    try {
      const result = run([], dir);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('app/api/tenant/deals/new-route.ts');
      expect(result.stderr).toContain('unlisted-file');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 1 with --json carrying the same finding', () => {
    const dir = fixture({
      'lib/ai/client.ts': "import { db } from '@/drizzle/db';",
      'scripts/tenant-db-ledger.json': JSON.stringify({ groups: {} }),
    });
    try {
      const result = run(['--json'], dir);
      expect(result.code).toBe(1);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.ok).toBe(false);
      expect(parsed.findings[0].code).toBe('unlisted-file');
      expect(parsed.offenders[0].file).toBe('lib/ai/client.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('this repository is clean today (#3405)', () => {
  it('every file that imports the raw client is admitted, by name', () => {
    const result = check();
    expect(result.findings.map((f: { code: string; message: string }) => `${f.code}: ${f.message}`)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.scannedOffenders).toBeGreaterThan(0);
  });

  it('every group argues its case and names #3405', () => {
    const ledger = JSON.parse(readFileSync(join(ROOT, 'scripts/tenant-db-ledger.json'), 'utf8'));
    const groups = Object.entries(ledger.groups) as Array<[string, { reason?: string; filedAs?: string; files?: string[] }]>;
    expect(groups.length).toBeGreaterThan(0);
    for (const [group, entry] of groups) {
      expect((entry.reason ?? '').length, `${group} has no argued reason`).toBeGreaterThanOrEqual(MIN_REASON_LENGTH);
      expect(entry.reason ?? '', `${group} is still a placeholder`).not.toMatch(/^todo/i);
      expect(entry.filedAs, `${group} names no issue`).toMatch(/^#\d+$/);
      expect(entry.files?.length, `${group} lists no files`).toBeGreaterThan(0);
    }
  });

  it('the choke point itself is exempt, which is why the ledger has 500 entries and not 511', () => {
    const offenders = scanRepo();
    expect(offenders.some((o: { file: string }) => o.file.startsWith('lib/db/'))).toBe(false);
  });
});
