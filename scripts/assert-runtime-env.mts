/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Runtime-flag assertion (#3271 ask 3) — what the server process will actually
 * see, printed before a deploy commits to it, and a non-zero exit when a
 * fail-closed flag is set wrong.
 *
 * The bug this catches is not a missing value in `.env.local`; it is a value
 * that is in the file and still absent from the running process. pm2 replays the
 * environment it captured at first `start`, and Next.js reads `.env.local` only
 * for names not already set, so `TRUST_PROXY` can be `true` on disk and unset in
 * every worker. `getClientIp()` then answers `'unknown'` for all traffic and
 * every auth endpoint fails closed with 503 — a working server that cannot
 * authenticate anyone, with nothing in the logs to say why.
 *
 * Two shapes are covered:
 *   npm run assert:runtime-env              pm2 VM — merges ecosystem.config.cjs's
 *                                           `env:` for the app that runs the Next
 *                                           server over this shell's environment
 *   npm run assert:runtime-env -- --process-only
 *                                           Docker — the container's own
 *                                           environment is the answer, so read
 *                                           only process.env (compose pins
 *                                           TRUST_PROXY=true in its own file)
 *
 * A platform that terminates the proxy for you (Vercel and the like) is not
 * misconfigured by leaving TRUST_PROXY unset: pass `--trust-proxy-optional` to
 * downgrade that one finding to a warning.
 */
import { createRequire } from 'node:module';
import { auditRuntimeFlags, type RuntimeFlagRow } from '../lib/env';

const require = createRequire(import.meta.url);

export interface AssertResult {
  rows: RuntimeFlagRow[];
  source: string;
  failures: number;
  warnings: number;
}

/** The env block of whichever pm2 app runs the Next server, if this config has one. */
export function nextAppEnv(config: { apps?: { name?: string; script?: string; env?: Record<string, unknown> }[] }): {
  label: string;
  env: Record<string, string | undefined>;
} {
  const app = (config.apps ?? []).find((a) => String(a.script).includes('next'));
  if (!app) return { label: 'no Next app in ecosystem.config.cjs', env: {} };
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(app.env ?? {})) env[key] = String(value);
  return { label: `ecosystem.config.cjs → pm2 "${app.name ?? '?'}"`, env };
}

export function assertRuntimeEnv(
  argv: string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): AssertResult {
  const processOnly = argv.includes('--process-only');
  let source = 'process.env';
  let effective = { ...env };
  if (!processOnly) {
    const target = nextAppEnv(require(`${process.cwd()}/ecosystem.config.cjs`));
    // pm2 puts the `env:` block into the child's environment, and dotenv/Next
    // never overwrite a name that is already there — so the block wins.
    effective = { ...env, ...target.env };
    source = target.label;
  }
  const rows = auditRuntimeFlags(effective, { trustProxyMayBeUnset: argv.includes('--trust-proxy-optional') });
  return {
    rows,
    source,
    failures: rows.filter((r) => r.status === 'fail').length,
    warnings: rows.filter((r) => r.status === 'warn').length,
  };
}

if (process.argv[1]?.includes('assert-runtime-env')) {
  const result = assertRuntimeEnv();
  console.log(`Runtime flags as seen by ${result.source}:`);
  for (const row of result.rows) {
    console.log(`  ${row.status.toUpperCase().padEnd(4)} ${row.name}=${row.value}`);
    if (row.status !== 'ok') console.log(`       ${row.note}`);
  }
  if (result.failures > 0) {
    console.error(`\nassert-runtime-env: ${result.failures} fail-closed misconfiguration(s).`);
    console.error('A changed value only reaches live pm2 workers with `pm2 reload ecosystem.config.cjs --update-env`.');
    process.exit(1);
  }
  if (result.warnings > 0) console.warn(`assert-runtime-env: ${result.warnings} warning(s), no failure.`);
}
