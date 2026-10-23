/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3099 — the rebuild docs and the acceptance harness pin a Node runtime this host no longer uses.
 *
 * `docs/BASECRM/` is the contract someone standing this app up again follows literally, and three of
 * its instructions were stale: `07-OPS-NOTES.md` told the reader to prepend
 * `node-v22.14.0-linux-x64` and to "verify" that a login shell resolves `v22.14.0`, `06-REBUILD-GUIDE.md`
 * Phase 0 step 1 repeated the same runtime name, and `scripts/simulate-basecrm-acceptance.ts`'s usage
 * block carried the same export. The host's `~/.bashrc` moved to `node-v22.23.4-linux-x64` and the old
 * line is commented out.
 *
 * The failure mode is not a broken path — `node-v22.14.0-linux-x64` is still on disk and still runs.
 * That is what makes the stale pin dangerous: following it *succeeds*, and `node -v` is ≥ 22 either
 * way, so nothing tells the reader they just shadowed the runtime every suite on this box was verified
 * with. `package.json` `engines.node` is `">=22.0.0"` and there is no `.nvmrc`, so no file in the repo
 * contradicts either choice; these instructions are the only place the choice is asserted, and an
 * assertion nothing checks drifts.
 *
 * So the gate here is the one thing a prose paragraph cannot do for itself: it holds the three
 * *instruction* sites to the runtime that resolves here, and holds the retired name where it is
 * legitimate — the sentence in 07 that warns about it.
 *
 * Deliberately NOT asserted: the specific version. `v22.23.4` is a fact about this host, not a repo
 * requirement; the day it is replaced, the assertion to update is "what `node -v` reports", and the
 * rule that survives is that the instruction and the host must not disagree.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const OPS = 'docs/BASECRM/07-OPS-NOTES.md';
const REBUILD = 'docs/BASECRM/06-REBUILD-GUIDE.md';
const SIM = 'scripts/simulate-basecrm-acceptance.ts';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

/** Every line of `rel` matching `re`, decorated as `file:line text` so a diff points at the line. */
function hits(rel: string, re: RegExp, src = read(rel)): string[] {
  return src
    .split('\n')
    .map((line, i) => ({ line, tag: `${rel}:${i + 1} ${line}` }))
    .filter(l => re.test(l.line))
    .map(l => l.tag);
}

/**
 * The runtime the host actually resolves, from a clean login shell (`env -i` so this shell's own
 * PATH cannot flatter the answer). Null when the host gives no single answer, in which case there is
 * nothing to pin the docs against and the suite says so instead of inventing a pass.
 */
function hostRuntime(): { version: string; binDir: string } | null {
  try {
    const out = execFileSync('bash', ['-lc', 'node -v; which node'], {
      encoding: 'utf8',
      env: { HOME: process.env.HOME ?? '/home/opc', PATH: '/usr/bin:/bin', TERM: 'xterm' },
    });
    const version = out.match(/v(\d+\.\d+\.\d+)/)?.[1];
    const nodePath = out.match(/^(\/.*\/node)$/m)?.[1];
    if (!version || !nodePath) return null;
    const binDir = nodePath.slice(0, -'/node'.length);
    return { version, binDir, runtimeDir: binDir.slice(0, -'/bin'.length).split('/').pop()! };
  } catch {
    return null;
  }
}

const HOST = hostRuntime();

describe('#3099 — the toolchain instructions match the host', () => {
  it('the host resolves one vendored runtime', () => {
    expect(HOST, 'bash -lc did not report both a node version and a node path').toBeTruthy();
    expect(HOST!.version).toMatch(/^22\./);
    expect(HOST!.binDir).toContain('node-v22');
  });

  it('the 07 export prepends the runtime the host resolves', () => {
    const lines = hits(OPS, /^\s*export PATH="\/home\/opc\/(node-v[\d.]+-linux-x64)\/bin:\$PATH"\s*$/m, read(OPS));
    expect(lines, '07 § Node no longer carries a single export line').toHaveLength(1);
    const pinned = lines[0].match(/node-v[\d.]+-linux-x64/)![0];
    expect(pinned).toBe(HOST!.runtimeDir);
  });

  it('the 07 verify step names the version the host reports', () => {
    const src = read(OPS);
    expect(src, 'the verify sentence is gone').toMatch(/Verify:/);
    expect(src).toContain('`v' + HOST!.version + '`');
    expect(src).toContain('`' + HOST!.binDir + '/node`');
  });

  it('06 Phase 0 names that same vendored runtime', () => {
    const step = read(REBUILD).match(/Node \*\*≥ 22\*\*[\s\S]{0,200}?07 § Node\)\./);
    expect(step, 'Phase 0 step 1 no longer points at 07 § Node').toBeTruthy();
    expect(step![0]).toContain('`node-v' + HOST!.version + '`');
    expect(step![0]).not.toMatch(/node-v22\.14\.0/);
  });

  it('the acceptance harness usage block exports that same runtime', () => {
    const usage = read(SIM).match(/Usage:\n([\s\S]*?)\n \* Re-run safe/);
    expect(usage, 'the sim usage block is gone').toBeTruthy();
    const exports_ = usage![1].match(/export PATH=\S+/g) ?? [];
    expect(exports_, 'the sim no longer tells the reader which PATH to export').toHaveLength(1);
    expect(exports_[0]).toContain(HOST!.binDir);
  });

  it('no instruction anywhere in the repo exports the retired runtime', () => {
    const grep = spawnSync('git', ['grep', '-nE', 'node-v22\\.14\\.0-linux-x64/bin', '--', 'docs', 'scripts', 'app', 'lib', '.github'], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    expect(grep.status <= 1, `git grep failed: ${grep.stderr}`).toBe(true);
    expect(grep.stdout.trim(), grep.stdout).toBe('');
  });
});

describe('#3099 — the warning stays written where it is true', () => {
  const src = read(OPS);

  it('keeps the retired runtime as a named hazard, not as an instruction', () => {
    expect(src).toMatch(/node-v22\.14\.0-linux-x64/);
    const bullet = src.slice(src.indexOf('## Node & toolchain'), src.indexOf('## Local worktrees'));
    const hazard = bullet.match(/node-v22\.14\.0-linux-x64/g) ?? [];
    expect(hazard, 'the warning was deleted along with the pin').toHaveLength(1);
    expect(bullet).toMatch(/retired/i);
    expect(bullet).toMatch(/commented out/i);
  });

  it('keeps the #2622 backstory that explains why a vendored runtime is on PATH at all', () => {
    expect(src).toMatch(/v16\.20\.2/);
    expect(src).toMatch(/#2622/);
    expect(src).toMatch(/engines require Node ≥ 22/);
  });

  it('tells a reader how to re-measure rather than only what was measured', () => {
    expect(src).toMatch(/env -i HOME=\$HOME bash -lc/);
  });

  it('still describes the runtime as vendored, so the pin reads as a path', () => {
    // prose is re-wrapped freely, so these match across line breaks rather than across exact lines
    expect(src).toMatch(/vendored,\s*not\s*installed/i);
    expect(src).toMatch(/no\s+version\s+manager\s+behind\s+it/i);
  });
});
