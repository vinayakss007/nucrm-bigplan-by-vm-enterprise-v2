#!/usr/bin/env node
/**
 * #2565 — run `next build` with TMPDIR on the root filesystem.
 *
 * Turbopack writes one temp directory per build into `std::env::temp_dir()`.
 * On this host that is `/tmp`, a 3.9 GB tmpfs: a killed build leaves its cache
 * behind and enough of them make the scratch space unusable. Pinning `TMPDIR`
 * for every build is the half that stops new growth; the daily timer
 * (`deploy/systemd/nucrm-tmp-sweep.timer`) removes what a kill still leaves.
 *
 * `npm run build` calls this wrapper instead of `next build` directly, so a
 * manual build, CI, and the deploy all get the same TMPDIR. Override it with
 * `NUCRM_BUILD_TMPDIR=/some/root/fs/path`. The directory is created 0700.
 *
 * Arguments are forwarded: `npm run build -- --debug` → `next build --debug`.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where Turbopack may write its per-build temp dirs. Never the tmpfs /tmp. */
export function buildTmpDir(env = process.env, platform = process.platform) {
  if (env.NUCRM_BUILD_TMPDIR) return env.NUCRM_BUILD_TMPDIR;
  if (platform === 'win32') {
    return join(env.TEMP || env.TMP || homedir(), 'nucrm-build');
  }
  return '/var/tmp/nucrm-build';
}

export function nextBin(repoRoot = process.cwd()) {
  return join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
}

/**
 * Spawn `next build` and resolve with its exit status. Signals are returned
 * rather than swallowed so the CLI can re-raise them (a CI cancel must look
 * cancelled, not like an exit code the build chose).
 */
export function runBuild(argv = [], opts = {}) {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const env = { ...(opts.env ?? process.env) };
  const tmpDir = buildTmpDir(env, opts.platform ?? process.platform);
  const bin = nextBin(repoRoot);

  if (!existsSync(bin)) {
    console.error(`[build] next is not installed at ${bin}; run npm ci first`);
    return Promise.resolve({ code: 1, signal: null });
  }

  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  env.TMPDIR = tmpDir;
  env.TMP = tmpDir;
  env.TEMP = tmpDir;

  return new Promise((resolvePromise) => {
    const child = spawn(opts.execPath ?? process.execPath, [bin, 'build', ...argv], {
      stdio: 'inherit',
      env,
    });
    child.on('error', (err) => {
      console.error(`[build] could not start next: ${err.message}`);
      resolvePromise({ code: 1, signal: null });
    });
    child.on('exit', (code, signal) => resolvePromise({ code: code ?? 1, signal }));
  });
}

async function main(argv) {
  const { code, signal } = await runBuild(argv);
  if (signal) {
    // Reproduce the child's fate: a cancelled build must not report a normal exit.
    process.kill(process.pid, signal);
    return code;
  }
  return code;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(await main(process.argv.slice(2)));
