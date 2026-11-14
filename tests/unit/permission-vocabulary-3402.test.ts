/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Permission vocabulary guard (#3402).
 *
 * The catalog in `lib/permissions/definitions.ts` is the only list the Roles UI can
 * offer, and `can()` reads one key per id. On `main` the two vocabularies disagreed
 * in both directions: 21 strings were enforced by handlers and absent from the
 * catalog (ungrantable — every non-admin 403, forever), and catalog ids were offered
 * to role editors that no handler ever reads. `scripts/check-permission-vocabulary.mjs`
 * pins both, undeclared checks fatal and with no baseline, inert ids on a shrink-only
 * floor.
 *
 * Usage: npx vitest run tests/unit/permission-vocabulary-3402.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCatalog,
  collectChecks,
  dynamicSuffixes,
  computeDelta,
  run,
  main,
  CHECK_FNS,
  DEFAULT_BASELINE_PATH,
} from '../../scripts/check-permission-vocabulary.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** A throwaway git repo: `run()` reads the tracked set, so a fixture has to be one. */
function fixtureTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'permvocab-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  for (const [path, content] of Object.entries(files)) {
    const abs = join(dir, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

const catalogWith = (ids: string[]) =>
  `export const PERMISSIONS = [\n${ids.map((id) => `  { id: '${id}', label: 'L', description: 'D', category: 'C', dangerLevel: 'safe' },`).join('\n')}\n];\n`;

describe('parseCatalog', () => {
  it('takes the ids in declaration order and reports nothing wrong with a clean file', () => {
    const out = parseCatalog(catalogWith(['a.view', 'b.edit']));
    expect(out.unique).toEqual(['a.view', 'b.edit']);
    expect(out.duplicates).toEqual([]);
    expect(out.malformed).toEqual([]);
  });

  it('flags a duplicate without losing it, and keeps the first copy in order', () => {
    const out = parseCatalog(catalogWith(['a.view', 'b.edit', 'a.view']));
    expect(out.ids).toHaveLength(3);
    expect(out.unique).toEqual(['a.view', 'b.edit']);
    expect(out.duplicates).toEqual(['a.view']);
  });

  it('flags an id that is not resource.action', () => {
    const out = parseCatalog(catalogWith(['invoicing', 'invoices.create', 'invoices']));
    expect(out.malformed).toEqual(['invoicing', 'invoices']);
  });

  it('accepts the underscore the real catalog uses', () => {
    expect(parseCatalog(catalogWith(['team.manage_roles'])).malformed).toEqual([]);
  });

  it('ignores an id: that is not the start of an entry line', () => {
    const out = parseCatalog("// { id: 'x.y', and\n  { id: 'a.view',\n");
    expect(out.unique).toEqual(['a.view']);
  });
});

describe('collectChecks', () => {
  const all = CHECK_FNS.join('/');

  it(`finds each enforcement helper (${all}) with any first argument`, () => {
    const src = [
      "  const deny = requirePerm(ctx, 'invoices.create');",
      "  if (can(ctx, 'deals.edit')) { }",
      "  const scope = ownerScope(ctx, 'contacts.view_all', contacts);",
      "  if (can(authCtx, 'leads.view')) { }",
    ].join('\n');
    expect(collectChecks(src, 'app/api/x/route.ts').map((c) => c.id)).toEqual([
      'invoices.create',
      'deals.edit',
      'contacts.view_all',
      'leads.view',
    ]);
  });

  it('reports the file and the line, because a finding nobody can find is a nuisance', () => {
    const one = collectChecks("export const POST = () => {\n  requirePerm(ctx, 'a.create');\n};", 'app/api/y/route.ts')[0];
    expect(one).toMatchObject({ id: 'a.create', path: 'app/api/y/route.ts', line: 2 });
  });

  it('does not treat a commented-out check as enforcement', () => {
    const src = ["  // requirePerm(ctx, 'todo.later')", "  /* can(ctx, 'prose.only') */", "  * can(ctx, 'jsdoc.only')"].join('\n');
    expect(collectChecks(src, 'a.ts')).toEqual([]);
  });

  it('records a template call as dynamic, never as an id', () => {
    const c = collectChecks('  requirePerm(ctx, `${table}.edit`);', 'app/api/tenant/data-explorer/route.ts')[0];
    expect(c.dynamic).toBe(true);
    expect(dynamicSuffixes([c])).toEqual(['.edit']);
  });

  it('takes the suffix after the last hole, which is what a dynamic check can reach', () => {
    const c = collectChecks("  can(ctx, `${entity}.${verb}`);", 'a.ts')[0];
    // Nothing static to match on, so no id is claimed covered — the screen declines to
    // guess rather than marking half the catalog enforced.
    expect(dynamicSuffixes([c])).toEqual([]);
  });
});

describe('computeDelta', () => {
  // Every id below is enforced by `live` except invoices.create, which sits on the
  // floor — so a test that adds nothing reports nothing, and each finding a test
  // names is one it planted.
  const base = {
    catalogIds: ['a.view', 'b.edit', 'invoices.create'],
    duplicates: [],
    malformed: [],
    floor: [{ id: 'invoices.create', reason: 'not enforced yet' }],
  };
  const checksOf = (sites) => sites.map(([id, path, line]) => ({ id, path, line }));
  const live = checksOf([['a.view', 'app/a.ts', 1], ['b.edit', 'app/b.ts', 1]]);

  it('names an enforced literal the catalog does not declare, with its site', () => {
    const d = computeDelta({ ...base, checks: [...live, ...checksOf([['ghost.write', 'app/api/g/route.ts', 7]])] });
    expect(d.findings).toEqual([{ kind: 'undeclared', id: 'ghost.write', path: 'app/api/g/route.ts', line: 7 }]);
  });

  it('does not flag an enforced id that IS declared', () => {
    const d = computeDelta({ ...base, checks: live });
    expect(d.findings).toEqual([]);
  });

  it('holds a new inert id fatal, and a floored one non-fatal', () => {
    const d = computeDelta({ ...base, catalogIds: [...base.catalogIds, 'projects.edit'], checks: live });
    expect(d.inert).toEqual(['invoices.create', 'projects.edit']);
    expect(d.findings.map((f) => f.kind)).toEqual(['new-inert']);
    expect(d.findings[0].id).toBe('projects.edit');
  });

  it('lets a dynamic suffix cover an id, so projects.edit is not called inert on a guess', () => {
    const d = computeDelta({
      ...base,
      catalogIds: [...base.catalogIds, 'projects.edit'],
      checks: [...live, { id: '${table}.edit', path: 'app/api/tenant/data-explorer/route.ts', line: 292, dynamic: true }],
    });
    expect(d.inert).toEqual(['invoices.create']);
    expect(d.findings).toEqual([]);
  });

  it('refuses a floor entry whose id is enforced again — the exemption outlived its code', () => {
    const checks = checksOf([
      ['a.view', 'app/a.ts', 1],
      ['b.edit', 'app/b.ts', 1],
      ['invoices.create', 'app/i/route.ts', 1],
    ]);
    const floor = [
      { id: 'invoices.create', reason: 'not enforced yet' },
      { id: 'gone.id', reason: 'was inert' },
    ];
    const d = computeDelta({ catalogIds: ['a.view', 'b.edit', 'invoices.create', 'gone.id'], duplicates: [], malformed: [], floor, checks });
    expect(d.findings).toEqual([{ kind: 'stale-floor', id: 'invoices.create' }]);
  });

  it('passes the hygiene findings through', () => {
    const d = computeDelta({ ...base, checks: live, duplicates: ['a.view'], malformed: ['weird'] });
    expect(d.findings.map((f) => `${f.kind}:${f.id}`).sort()).toEqual(['duplicate-id:a.view', 'malformed-id:weird']);
  });
});

describe('the vocabulary on this tree', () => {
  const result = run(ROOT);

  it('is clean: nothing enforced is undeclared, nothing inert is unrecorded', () => {
    expect(result.findings).toEqual([]);
  });

  it('counts itself, so the denominators cannot rot into a lie', () => {
    expect(result.counts.catalog).toBe(87);
    expect(result.counts.checked).toBeGreaterThanOrEqual(73);
    expect(result.filesScanned).toBeGreaterThan(1000);
    expect(result.counts.dynamic).toBe(2);
    expect(result.counts.suffixes).toEqual(['.edit', '.delete']);
  });

  it('declares every id the handlers already required before #3402 — the 21 ungrantable checks', () => {
    const previouslyUngrantable = [
      'calendar.manage', 'companies.assign', 'companies.export', 'companies.import', 'companies.view',
      'contacts.email', 'contacts.view', 'deals.export', 'deals.import', 'meetings.create', 'meetings.view',
      'partners.create', 'projects.create', 'projects.delete', 'projects.edit', 'quotes.delete', 'quotes.edit',
      'reports.create', 'subscriptions.delete', 'subscriptions.edit', 'tasks.view',
    ];
    const { unique } = parseCatalog(readFileSync(join(ROOT, 'lib/permissions/definitions.ts'), 'utf8'));
    for (const id of previouslyUngrantable) expect(unique).toContain(id);
  });

  it('still enforces them, so the fix was the catalog and not a quiet relaxation', () => {
    const catalog = parseCatalog(readFileSync(join(ROOT, 'lib/permissions/definitions.ts'), 'utf8'));
    const checks = [];
    for (const f of execFileSync('git', ['ls-files', '--', 'app', 'lib'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((x) => /\.tsx?$/.test(x))) {
      checks.push(...collectChecks(readFileSync(join(ROOT, f), 'utf8'), f));
    }
    const enforced = new Set(checks.filter((c) => !c.dynamic).map((c) => c.id));
    for (const id of catalog.unique) if (['projects.create', 'contacts.view', 'tasks.view', 'calendar.manage'].includes(id)) {
      expect(enforced.has(id)).toBe(true);
    }
  });

  it('is honest that 6 ids are still configured but unread — that is #3402 PR-2E, not this screen', () => {
    expect(result.counts.inert).toBe(6);
    expect(result.inert).not.toContain('invoices.create');
    expect(result.inert).not.toContain('invoices.send');
    expect(result.inert).not.toContain('contracts.create');
    expect(result.inert).not.toContain('contracts.sign');
    expect(result.inert).not.toContain('subscriptions.manage');
    expect(result.inert).toContain('quotes.manage');
    expect(result.inert).not.toContain('team.view');
    expect(result.inert).not.toContain('team.remove');
    expect(result.inert).not.toContain('team.manage_roles');
    expect(result.inert).not.toContain('projects.edit');
  });

  it('writes a reason for every floor entry, because an unnamed exemption is not reviewable', () => {
    const floor = JSON.parse(readFileSync(join(ROOT, DEFAULT_BASELINE_PATH), 'utf8'));
    expect(floor.inert).toHaveLength(6);
    for (const entry of floor.inert) {
      expect(typeof entry.reason).toBe('string');
      expect(entry.reason.length).toBeGreaterThan(20);
      expect(entry.reason).toContain('3402');
    }
  });

  it('cannot change a live grant by accident: DEFAULT_ROLE_PERMISSIONS has no production importer', () => {
    const hits = execFileSync('sh', ['-c', "grep -rl 'DEFAULT_ROLE_PERMISSIONS' app lib scripts || true"], { cwd: ROOT, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
      .filter((f) => f !== 'lib/permissions/definitions.ts');
    expect(hits).toEqual([]);
  });
});

describe('the screen bites', () => {
  it('refuses an enforced permission the catalog does not declare, with no baseline to hide behind', () => {
    const dir = fixtureTree({
      'lib/permissions/definitions.ts': catalogWith(['a.view']),
      'app/api/x/route.ts': "requirePerm(ctx, 'a.view');\nexport const POST = () => requirePerm(ctx, 'ghost.write');\n",
      'scripts/permission-vocabulary-baseline.json': JSON.stringify({ inert: [] }),
    });
    const d = run(dir);
    expect(d.findings).toEqual([{ kind: 'undeclared', id: 'ghost.write', path: 'app/api/x/route.ts', line: 2 }]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses an inert id nobody recorded', () => {
    const dir = fixtureTree({
      'lib/permissions/definitions.ts': catalogWith(['a.view', 'b.view']),
      'app/api/x/route.ts': "export const GET = () => requirePerm(ctx, 'a.view');\n",
      'scripts/permission-vocabulary-baseline.json': JSON.stringify({ inert: [{ id: 'b.view', reason: 'not yet' }] }),
    });
    expect(run(dir).findings).toEqual([]);
    const dropped = fixtureTree({
      'lib/permissions/definitions.ts': catalogWith(['a.view', 'b.view', 'c.view']),
      'app/api/x/route.ts': "export const GET = () => requirePerm(ctx, 'a.view');\n",
      'scripts/permission-vocabulary-baseline.json': JSON.stringify({ inert: [{ id: 'b.view', reason: 'not yet' }] }),
    });
    expect(run(dropped).findings).toEqual([{ kind: 'new-inert', id: 'c.view' }]);
    rmSync(dir, { recursive: true, force: true });
    rmSync(dropped, { recursive: true, force: true });
  });

  it('refuses a missing catalog, an id-less catalog and an empty scan rather than passing them', () => {
    // The catalog for the empty-scan case sits OUTSIDE `app`/`lib`, because a catalog
    // inside them would itself be a tracked .ts file and the scan would not be empty.
    const empty = fixtureTree({
      'standalone/definitions.ts': catalogWith(['a.view']),
      'README.md': 'nothing here\n',
    });
    expect(() => run(empty, { catalog: 'standalone/definitions.ts' })).toThrow(/no \.ts\/\.tsx files tracked/);
    const noIds = fixtureTree({
      'lib/permissions/definitions.ts': 'export const PERMISSIONS = [];\n',
      'app/api/x/route.ts': "requirePerm(ctx, 'a.view');\n",
    });
    expect(() => run(noIds)).toThrow(/declares no permission ids/);
    const noChecks = fixtureTree({
      'lib/permissions/definitions.ts': catalogWith(['a.view']),
      'app/api/x/route.ts': 'export const GET = () => Response.json({});\n',
    });
    expect(() => run(noChecks)).toThrow(/no permission check found/);
    expect(() => run(resolve(empty, 'nope'))).toThrow(/catalog not found/);
    rmSync(empty, { recursive: true, force: true });
    rmSync(noIds, { recursive: true, force: true });
    rmSync(noChecks, { recursive: true, force: true });
  });

  it('refuses a baseline that is absent, unparsable, shapeless, reasonless or duplicated', () => {
    const bare = fixtureTree({
      'lib/permissions/definitions.ts': catalogWith(['a.view']),
      'app/api/x/route.ts': "requirePerm(ctx, 'a.view');\n",
    });
    // A missing floor is not a refusal here — the CLI owns that verdict, and the test
    // below drives main() to assert it.
    expect(run(bare).floorMissing).toBe(true);
    const bad = (contents: string) => {
      const dir = fixtureTree({
        'lib/permissions/definitions.ts': catalogWith(['a.view']),
        'app/api/x/route.ts': "requirePerm(ctx, 'a.view');\n",
        'scripts/permission-vocabulary-baseline.json': contents,
      });
      try {
        return run(dir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    expect(() => bad('not json')).toThrow(/not valid JSON/);
    expect(() => bad('{}')).toThrow(/no "inert" array/);
    expect(() => bad('{"inert":[{"id":"x"}]}')).toThrow(/written reason/);
    expect(() => bad('{"inert":[{"id":"x","reason":"  "}]}')).toThrow(/written reason/);
    expect(() => bad('{"inert":[{"id":"x","reason":"r"},{"id":"x","reason":"r"}]}')).toThrow(/lists x twice/);
    rmSync(bare, { recursive: true, force: true });
  });

  it('exits 1 on a planted finding and 0 on the real tree, through the CLI', () => {
    const dir = fixtureTree({
      'lib/permissions/definitions.ts': catalogWith(['a.view']),
      'app/api/x/route.ts': "requirePerm(ctx, 'ghost.write');\n",
      'scripts/permission-vocabulary-baseline.json': JSON.stringify({ inert: [] }),
    });
    const before = process.cwd();
    process.chdir(dir);
    try {
      expect(main([])).toBe(1);
      expect(main(['--json'])).toBe(1);
    } finally {
      process.chdir(before);
      rmSync(dir, { recursive: true, force: true });
    }
    expect(main([])).toBe(0);
  });

  it('prints a JSON verdict whose arithmetic agrees with its findings', () => {
    // A child process, not a patched process.stdout.write: vitest owns the console
    // here, and a screen whose --json cannot be piped into jq is not worth having.
    const out = spawnSync(process.execPath, ['scripts/check-permission-vocabulary.mjs', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(out.status).toBe(0);
    const parsed = JSON.parse(out.stdout);
    expect(parsed.findings).toEqual([]);
    expect(parsed.inert).toBe(parsed.floor);
    expect(parsed.catalog).toBeGreaterThanOrEqual(parsed.checked);
  });

  it('--update writes exactly the live inert set, each with a reason', () => {
    const dir = fixtureTree({
      'lib/permissions/definitions.ts': catalogWith(['a.view', 'b.view', 'c.view']),
      'app/api/x/route.ts': "requirePerm(ctx, 'a.view');\nrequirePerm(ctx, `${t}.edit`);\n",
      'scripts/permission-vocabulary-baseline.json': JSON.stringify({ inert: [] }),
    });
    const before = process.cwd();
    process.chdir(dir);
    try {
      expect(main(['--update'])).toBe(0);
      const floor = JSON.parse(readFileSync(join(dir, 'scripts/permission-vocabulary-baseline.json'), 'utf8'));
      expect(floor.inert.map((e) => e.id)).toEqual(['b.view', 'c.view']);
      expect(floor.inert.every((e) => typeof e.reason === 'string' && e.reason.length > 20)).toBe(true);
      expect(main([])).toBe(0);
    } finally {
      process.chdir(before);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
