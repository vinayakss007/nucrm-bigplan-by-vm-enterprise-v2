import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Unit tests for the `prebuild` guard (#2969):
 *   - scripts/check-build-env.mjs
 *
 * The guard refuses a build that is going to fail anyway. It already rejected
 * NODE_ENV=development; #2969 added the second case — a symlinked node_modules,
 * which Turbopack cannot resolve and panics on *mid-compile*, so the operator
 * pays several minutes of build before learning that the worktree was prepared
 * with `ln -s` instead of `cp -al` (07 § Local worktrees). These tests run the
 * CLI against real fixture trees, the way the register guards do, because the
 * behaviour under test is the exit code and the wording of the refusal.
 */

const ROOT = join(import.meta.dirname!, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-build-env.mjs');

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'build-env-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(cwd: string, nodeEnv: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd,
    env: { ...process.env, NODE_ENV: nodeEnv },
    encoding: 'utf8',
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** A fixture project dir whose node_modules is `kind`. */
function project(name: string, kind: 'symlink' | 'real' | 'absent'): string {
  const root = join(dir, name);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  if (kind === 'symlink') {
    mkdirSync(join(root, 'vendored'), { recursive: true });
    symlinkSync(join(root, 'vendored'), join(root, 'node_modules'), 'dir');
  } else if (kind === 'real') {
    mkdirSync(join(root, 'node_modules'), { recursive: true });
  }
  return root;
}

describe('check-build-env.mjs — node_modules resolution (#2969)', () => {
  it('refuses a symlinked node_modules, before the build can panic', () => {
    const out = run(project('link', 'symlink'), 'production');

    expect(out.status).toBe(1);
    expect(out.out).toContain('node_modules is a symlink');
    // The refusal is only useful if it names the fix, not just the failure.
    expect(out.out).toContain('cp -al');
  });

  it('passes a real node_modules directory', () => {
    const out = run(project('real', 'real'), 'production');

    expect(out.status).toBe(0);
    expect(out.out).toContain('[check-build-env] OK');
  });

  it('stays out of the way when node_modules is simply absent', () => {
    const out = run(project('none', 'absent'), 'production');

    expect(out.status).toBe(0);
    expect(out.out).toContain('[check-build-env] OK');
  });

  it('runs the node_modules check even when NODE_ENV is unset', () => {
    // Next defaults NODE_ENV to production in that case, so the build would
    // still spend minutes before the Turbopack panic.
    const root = project('unset', 'symlink');
    const r = spawnSync(process.execPath, [SCRIPT], {
      cwd: root,
      env: { ...process.env, NODE_ENV: undefined },
      encoding: 'utf8',
    });

    expect(r.status).toBe(1);
    expect(`${r.stdout ?? ''}${r.stderr ?? ''}`).toContain('node_modules is a symlink');
  });

  it('keeps refusing NODE_ENV=development', () => {
    const out = run(project('dev', 'real'), 'development');

    expect(out.status).toBe(1);
    expect(out.out).toContain('NODE_ENV=development');
  });
});
