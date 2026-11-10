/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import YAML from 'yaml';
import { analyse, main } from '../../scripts/check-pool-mode-invariant.mjs';

// #3404: `lib/db/rls.ts` sets `app.current_tenant` with `set_config(..., is_local=false)`
// — a SESSION-scoped GUC (ADR-0003) — and five declarations of the pooler mode disagreed
// while nothing asserted any of them. This screen PARSES the compose YAML, so the cases
// below are planted declarations, not planted strings: a rule that only fires on the one
// spelling a grep knew about is the failure mode this file exists to replace.

const ROOT = join(import.meta.dirname!, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-pool-mode-invariant.mjs');

/** A compose `services:` block, parsed exactly the way the guard parses one. */
const services = (yamlBody: string) => YAML.parse(`services:\n${yamlBody}`).services;
const onePooler = (envLines: string) => services(`  pgbouncer:\n    image: edoburu/pgbouncer\n    environment:\n${envLines}`);
const rulesOf = (r: { findings: { rule: string }[] }) => r.findings.map((f) => f.rule);
const detailOf = (r: { findings: { rule: string; detail: string }[] }, rule: string) =>
  r.findings.find((f) => f.rule === rule)?.detail ?? '';

/** A file whose only service is the pooler itself, so it counts as unused unless annotated. */
const unused = (envLines: string, iniText: string | null = null, annotations: Record<string, unknown> = {}) =>
  analyse({ 'planted.yml': onePooler(envLines) }, iniText, annotations);

describe('the real tree (#3404)', () => {
  const r = main({ root: ROOT });

  it('is green, and the walk saw the poolers that exist', () => {
    expect(r.findings).toEqual([]);
    expect(r.code).toBe(0);
    // 3 compose files declare a pooler and the ini is read too. If a compose file is
    // renamed or deleted the count drops and this says so, instead of the guard
    // quietly losing a file it used to check.
    expect(r.poolerCount).toBe(3);
  });

  it('every compose file the guard claims to read is on disk', () => {
    const declared = ['docker-compose.yml', 'deploy/docker-compose.yml', 'deploy/docker-compose.preprod.yml', 'deploy/docker-compose.production.yml'];
    const present = declared.filter((f) => {
      try {
        readFileSync(join(ROOT, f), 'utf8');
        return true;
      } catch {
        return false;
      }
    });
    expect(present.length).toBeGreaterThanOrEqual(3);
    // `deploy/docker-compose.yml` is the one this list carries as an option, not a fact.
    expect(present).toContain('docker-compose.yml');
    expect(present).toContain('deploy/docker-compose.production.yml');
  });

  it('the two poolers nothing routes through are annotated, not ignored', () => {
    // R5 turns "declared and unused" into an advisory only when the annotation file
    // carries a reason and an issue for it. Assert both halves are actually read.
    expect(r.advisories.filter((a: string) => a.includes('unused pooler'))).toHaveLength(2);
    expect(r.advisories.some((a: string) => a.includes('listen_addr = 0.0.0.0'))).toBe(true);
  });

  it('the annotations file is machine-checkable, not prose', () => {
    const ann = JSON.parse(readFileSync(join(ROOT, 'scripts/pool-mode-annotations.json'), 'utf8'));
    const entries = Object.entries(ann).filter(([k]) => !k.startsWith('_'));
    expect(entries.length).toBeGreaterThan(0);
    for (const [file, a] of entries) {
      const value = a as { reason?: string; issue?: string };
      expect(value.reason, `${file} needs a reason`).toMatch(/\S{20,}/);
      expect(value.issue, `${file} needs the issue that knows about it`).toMatch(/^#\d+$/);
    }
  });

  it('the CLI exits 0 on the tree it guards', () => {
    const out = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain('[guard:pool-mode] ✅');
  });

  it('is wired: an alias, a ci.yml step, and the census paragraph that must agree', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['guard:pool-mode']).toBe('node scripts/check-pool-mode-invariant.mjs');
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toMatch(/^\s*run: npm run guard:pool-mode\s*$/m);
    expect(readFileSync(join(ROOT, 'docs/README.md'), 'utf8')).toContain('`guard:pool-mode`');
  });
});

describe('R1 — the mode must be declared, and must be session', () => {
  it('fails a transaction-mode pooler, naming the rule', () => {
    const r = unused('      - POOL_MODE=transaction\n      - SERVER_RESET_QUERY=DISCARD ALL\n');
    expect(rulesOf(r)).toContain('R1 pool_mode declared');
  });

  it('fails an UNDECLARED mode, because holding by default is not declaring', () => {
    const r = unused('      - SERVER_RESET_QUERY=DISCARD ALL\n      - DEFAULT_POOL_SIZE=20\n');
    expect(detailOf(r, 'R1 pool_mode declared')).toMatch(/unset/);
  });

  it('catches the map form with a quoted value — the spelling a grep of `POOL_MODE=session` misses', () => {
    const r = analyse(
      { 'planted.yml': services('  pgbouncer:\n    environment:\n      POOL_MODE: "transaction"\n      SERVER_RESET_QUERY: "DISCARD ALL"\n') },
      null,
      { 'planted.yml': { reason: 'annotated so only R1 can fire here', issue: '#3404' } },
    );
    expect(rulesOf(r)).toEqual(['R1 pool_mode declared']);
  });

  it('passes session mode with its reset query', () => {
    const r = unused('      - POOL_MODE=session\n      - SERVER_RESET_QUERY=DISCARD ALL\n');
    expect(r.findings.filter((f: { rule: string }) => /^R[12]/.test(f.rule))).toEqual([]);
  });
});

describe('R2/R3 — the reset query, in the mode where it works', () => {
  it('names the LEAK COMBINATION when transaction pooling has no reset at all', () => {
    // This is the exact shape `deploy/docker-compose.production.yml` carried: the mode
    // that recycles the server connection, and no `server_reset_query` — which is inert
    // in that mode anyway, so nothing was ever going to clear the GUC.
    const r = unused('      - POOL_MODE=transaction\n      - DEFAULT_POOL_SIZE=20\n');
    expect(detailOf(r, 'R2 reset query')).toMatch(/leak combination/);
  });

  it('still requires a reset under session pooling', () => {
    const r = unused('      - POOL_MODE=session\n      - DEFAULT_POOL_SIZE=20\n');
    expect(rulesOf(r)).toContain('R2 reset query');
  });

  it('rejects SERVER_RESET_QUERY_ALWAYS, which wipes the GUC mid-session', () => {
    // The other half of the same trap: "make the reset run anyway" under transaction
    // pooling, which under session pooling discards the GUC between two statements of
    // one request — the evaporation ADR-0003 was written about.
    const r = unused('      - POOL_MODE=session\n      - SERVER_RESET_QUERY=DISCARD ALL\n      - SERVER_RESET_QUERY_ALWAYS=DISCARD ALL\n');
    expect(rulesOf(r)).toContain('R3 reset-always absent');
  });
});

describe('R4 — the ini must say what the live files say', () => {
  it('fails a transaction ini even when every compose file is clean', () => {
    const r = analyse(
      { 'planted.yml': onePooler('      - POOL_MODE=session\n      - SERVER_RESET_QUERY=DISCARD ALL\n') },
      '[pgbouncer]\npool_mode = transaction\n',
      { 'planted.yml': { reason: 'annotated so only the ini can fail here', issue: '#3404' } },
    );
    expect(rulesOf(r)).toEqual(['R4 ini agrees']);
  });

  it('fails an ini with no mode line at all', () => {
    const r = analyse({ 'planted.yml': onePooler('      - POOL_MODE=session\n      - SERVER_RESET_QUERY=DISCARD ALL\n') }, '[pgbouncer]\nlisten_addr = 127.0.0.1\n', {});
    expect(detailOf(r, 'R4 ini agrees')).toMatch(/no pool_mode/);
  });

  it('is silent about an ini that does not exist, and advises on a 0.0.0.0 bind', () => {
    // Annotated throughout: the pooler is unused by design in these fixtures, so the
    // only thing that can make them differ is the ini.
    const ANN = { 'planted.yml': { reason: 'a fixture pooler, annotated so only the ini is under test', issue: '#3404' } };
    const clean = analyse({ 'planted.yml': onePooler('      - POOL_MODE=session\n      - SERVER_RESET_QUERY=DISCARD ALL\n') }, null, ANN);
    expect(clean.findings).toEqual([]);
    const wild = analyse({ 'planted.yml': onePooler('      - POOL_MODE=session\n      - SERVER_RESET_QUERY=DISCARD ALL\n') }, '[pgbouncer]\npool_mode = session\nlisten_addr = 0.0.0.0\n', ANN);
    expect(wild.findings).toEqual([]);
    expect(wild.advisories.join('\n')).toMatch(/listen_addr = 0\.0\.0\.0/);
  });
});

describe('R5 — unused is allowed, unused and silent is not', () => {
  const sessionEnv = '      - POOL_MODE=session\n      - SERVER_RESET_QUERY=DISCARD ALL\n';

  it('fails a pooler nothing routes through and nothing annotates', () => {
    expect(rulesOf(analyse({ 'planted.yml': onePooler(sessionEnv) }, null, {}))).toContain('R5 wired honestly');
  });

  it('does not fire when a service in the same file actually points at the pooler', () => {
    const withConsumer = services([
      '  pgbouncer:',
      '    environment:',
      '      - POOL_MODE=session',
      '      - SERVER_RESET_QUERY=DISCARD ALL',
      '  web:',
      '    environment:',
      '      - PGBOUNCER_ENABLED=true',
      '      - DATABASE_URL=postgres://app:pw@pgbouncer:6432/nucrm',
    ].join('\n'));
    expect(analyse({ 'planted.yml': withConsumer }, null, {}).findings).toEqual([]);
  });

  it('treats a :6432 DATABASE_URL as routing through the pooler', () => {
    const viaPort = services('  pgbouncer:\n    environment:\n' + sessionEnv + '  worker:\n    environment:\n      - DATABASE_URL=postgres://app:pw@pooler:6432/nucrm\n');
    expect(analyse({ 'planted.yml': viaPort }, null, {}).findings).toEqual([]);
  });

  it('accepts only a complete annotation: a reason without an issue is still silent', () => {
    expect(rulesOf(analyse({ 'planted.yml': onePooler(sessionEnv) }, null, { 'planted.yml': { reason: 'no consumer, and no issue number either' } }))).toContain('R5 wired honestly');
    const annotated = analyse({ 'planted.yml': onePooler(sessionEnv) }, null, { 'planted.yml': { reason: 'no consumer, annotated', issue: '#3404' } });
    expect(annotated.findings).toEqual([]);
    expect(annotated.advisories.join('\n')).toContain('#3404');
  });
});

describe('capacity is an advisory, never a finding', () => {
  it('says MAX_DB_CONNECTIONS is the real ceiling without failing the build over it', () => {
    const r = analyse({ 'planted.yml': onePooler('      - POOL_MODE=session\n      - SERVER_RESET_QUERY=DISCARD ALL\n      - MAX_CLIENT_CONN=200\n      - MAX_DB_CONNECTIONS=50\n') }, null, { 'planted.yml': { reason: 'annotated so the ceiling is only advice', issue: '#3404' } });
    expect(r.findings).toEqual([]);
    expect(r.advisories.join('\n')).toMatch(/MAX_DB_CONNECTIONS=50 is the real concurrency ceiling/);
  });
});

describe('R0 — an unreadable declaration is a finding, never a skip', () => {
  it('reports the file it could not parse, instead of guarding only the files it likes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pool-mode-r0-3404-'));
    try {
      writeFileSync(join(dir, 'docker-compose.yml'), 'services:\n  pgbouncer:\n    environment: [unclosed\n');
      const r = main({ root: dir });
      expect(r.code).toBe(1);
      expect(rulesOf(r)).toContain('R0 compose parseable');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is exit 2 only when there is no compose file to read at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pool-mode-empty-3404-'));
    try {
      expect(main({ root: dir }).code).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the guard reports, it does not read the room', () => {
  it('a container-less tree is exit 2, and --allow-empty downgrades it without silencing a finding', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pool-mode-3404-'));
    try {
      expect(main({ root: dir }).code).toBe(2);
      const cli = spawnSync('node', [SCRIPT, '--allow-empty', '--root', dir], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, POOL_MODE_ALLOW_EMPTY: '1' } });
      expect(cli.status).toBe(0);
      expect(cli.stdout).toContain('allowed empty');

      mkdirSync(join(dir, 'deploy'), { recursive: true });
      writeFileSync(join(dir, 'docker-compose.yml'), 'services:\n  pgbouncer:\n    environment:\n      - POOL_MODE=transaction\n');
      const planted = spawnSync('node', [SCRIPT, '--allow-empty', '--root', dir], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, POOL_MODE_ALLOW_EMPTY: '1' } });
      expect(planted.status, 'a finding must survive --allow-empty').toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
