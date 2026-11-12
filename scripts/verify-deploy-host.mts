#!/usr/bin/env npx tsx
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3268 — prove the deploy host matches the commit before and after restart.
 *
 * Usage:
 *   npm run deploy:verify-host -- --phase working-tree
 *   npm run deploy:verify-host -- --phase pre
 *   npm run deploy:verify-host -- --phase post
 *   npm run deploy:verify-host -- --phase all
 *
 * `deploy.yml` calls the phases at the points where each fact is knowable:
 *   working-tree  before `git checkout --force` (a local patch is about to be lost)
 *   pre           after checkout + npm ci   (tree clean, S3 buckets, backup role)
 *   post          after pm2 restarts        (all four processes online)
 *
 * Exit codes: 0 = every requested check passed; 1 = a check failed.
 * Prints no credentials, endpoints or connection strings.
 */
import { pathToFileURL } from 'node:url';
import {
  DeployHostVerificationError,
  assertWorkingTreeClean,
  readGitStatus,
  runPostDeployChecks,
  runPreDeployChecks,
} from './lib/deploy-host-verification.mts';

type Phase = 'working-tree' | 'pre' | 'post' | 'all';

const USAGE = `Usage: npm run deploy:verify-host -- [--phase <working-tree|pre|post|all>]

  working-tree  fail if the working copy has local changes
  pre           working tree + S3 buckets + backup role (after checkout/npm ci)
  post          all four pm2 apps exist and are online (after restart)
  all           every check above (default)
`;

function parsePhase(argv: readonly string[]): Phase {
  let phase: Phase = 'all';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(USAGE);
      process.exit(0);
    }
    if (arg === '--phase') {
      const value = argv[i + 1];
      if (
        value !== 'working-tree' &&
        value !== 'pre' &&
        value !== 'post' &&
        value !== 'all'
      ) {
        throw new DeployHostVerificationError(
          `--phase needs one of working-tree|pre|post|all\n\n${USAGE}`,
        );
      }
      phase = value;
      i += 1;
      continue;
    }
    throw new DeployHostVerificationError(`unknown option ${arg}\n\n${USAGE}`);
  }
  return phase;
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  try {
    const phase = parsePhase(argv);

    if (phase === 'working-tree' || phase === 'all') {
      assertWorkingTreeClean(readGitStatus(), 'before checkout');
      console.log('[deploy:verify-host] working tree is clean');
    }

    if (phase === 'pre' || phase === 'all') {
      await runPreDeployChecks();
      console.log(
        '[deploy:verify-host] S3 buckets and backup role are reachable',
      );
    }

    if (phase === 'post' || phase === 'all') {
      runPostDeployChecks();
      console.log(
        '[deploy:verify-host] web, worker, cron and realtime are online',
      );
    }

    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[deploy:verify-host] FAIL: ${message}`);
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().then((code) => {
    process.exitCode = code;
  });
}
