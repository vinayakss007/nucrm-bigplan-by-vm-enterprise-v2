/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3268 — the deploy host must match the commit it claims to run.
 *
 * `deploy.yml` updates the VM with `git checkout --force <sha>`. That is
 * deliberately destructive: any tracked edit or untracked file that exists only
 * on the host is silently reverted, so the deploy can return the machine to a
 * state the repository does not describe. The same class of drift hides a
 * missing pm2 consumer, an unconfigured bucket, or a backup role that cannot
 * read tenant rows.
 *
 * These checks are the loud version of those four facts. They run on the host,
 * not in CI, because only the host knows what its working copy, pm2 table, S3
 * credentials and backup role actually are.
 */

import { execFileSync } from 'node:child_process';
import {
  describeS3ConfigGap,
  getS3Config,
  type S3Config,
} from '../../lib/storage/s3-config.ts';

export class DeployHostVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeployHostVerificationError';
  }
}

/** The three consumers `deploy.yml` restarts besides the web process. */
export const REQUIRED_BACKGROUND_APPS = ['worker', 'cron', 'realtime'] as const;

/** Production has run as either `web` (ecosystem.config.cjs) or `nucrm-prod`. */
export const WEB_APP_ALIASES = ['web', 'nucrm-prod'] as const;

export interface Pm2Process {
  name: string;
  status: string;
}

/** Read `git status --porcelain` from the deploy working copy. */
export function readGitStatus(cwd: string = process.cwd()): string {
  return execFileSync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * A non-empty status means the working copy carries something the commit does
 * not. Fail before `git checkout --force` can throw it away, and again after
 * checkout if a previous step re-created it.
 */
export function assertWorkingTreeClean(
  status: string,
  when: string = 'before checkout',
): void {
  if (!status) return;

  const lines = status.split('\n').filter(Boolean);
  const shown = lines.slice(0, 20);
  const more =
    lines.length > shown.length
      ? `\n  … and ${lines.length - shown.length} more`
      : '';
  throw new DeployHostVerificationError(
    `The deploy host has ${lines.length} local change(s) ${when}. ` +
      '`git checkout --force` would discard them, and a patch that exists only on the host would ' +
      'disappear (#3268). Commit the change to the repository or remove it, then re-run the deploy.\n  ' +
      shown.join('\n  ') +
      more,
  );
}

/** Read the pm2 process table. `jlist` is JSON; some pm2 versions prefix it. */
export function readPm2List(): string {
  try {
    return execFileSync('pm2', ['jlist'], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new DeployHostVerificationError(
      `pm2 jlist failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function parsePm2List(raw: string): Pm2Process[] {
  // pm2 sometimes prints a `[PM2] …` banner before the JSON. Find the first
  // line that actually starts a JSON array, not the first `[` in the output.
  const lines = raw.split('\n');
  const arrayLine = lines.findIndex((line) =>
    /^\s*\[(?:\s*[{\]]|\s*$)/.test(line),
  );
  if (arrayLine === -1) {
    throw new DeployHostVerificationError(
      'pm2 jlist did not return a JSON process table; the host cannot prove its consumers are running (#3268).',
    );
  }

  const json = lines.slice(arrayLine).join('\n').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new DeployHostVerificationError(
      'pm2 jlist returned malformed JSON; the host cannot prove its consumers are running (#3268).',
    );
  }
  if (!Array.isArray(parsed)) {
    throw new DeployHostVerificationError(
      'pm2 jlist returned a non-array value; the host cannot prove its consumers are running (#3268).',
    );
  }

  return parsed.map((entry) => {
    const record = entry as { name?: unknown; pm2_env?: { status?: unknown } };
    return {
      name: typeof record.name === 'string' ? record.name : '',
      status:
        typeof record.pm2_env?.status === 'string'
          ? record.pm2_env.status
          : 'unknown',
    };
  });
}

/**
 * `deploy_all_and_wait` restarts four processes. A healthy web process is not
 * evidence that worker/cron/realtime exist — that is exactly how stale workers
 * and silently dead crons ship (#2300, #3252).
 */
export function assertPm2Apps(processes: readonly Pm2Process[]): void {
  const byName = new Map(
    processes.map((process) => [process.name, process.status]),
  );
  const problems: string[] = [];

  const web = WEB_APP_ALIASES.find((name) => byName.has(name));
  if (!web) {
    problems.push(`missing pm2 app: one of ${WEB_APP_ALIASES.join(' / ')}`);
  } else if (byName.get(web) !== 'online') {
    problems.push(`${web} is ${byName.get(web)} (expected online)`);
  }

  for (const name of REQUIRED_BACKGROUND_APPS) {
    if (!byName.has(name)) {
      problems.push(`missing pm2 app: ${name}`);
    } else if (byName.get(name) !== 'online') {
      problems.push(`${name} is ${byName.get(name)} (expected online)`);
    }
  }

  if (problems.length > 0) {
    throw new DeployHostVerificationError(
      `pm2 does not have the four apps this deploy starts (#3268):\n  ${problems.join('\n  ')}\n` +
        'The web health endpoint can stay green while a background consumer is missing or errored.',
    );
  }
}

export interface BucketProbe {
  send(command: unknown): Promise<unknown>;
  destroy?(): void;
}

/**
 * Both the user-file bucket and the backup bucket must answer `HeadBucket`.
 * A `PutObject`-only role is a real deployment shape, but it is not a shape
 * this gate can certify, and "unverifiable" is exactly what #3268 is about.
 */
export async function assertBucketsReachable(
  config: S3Config,
  client: BucketProbe,
): Promise<void> {
  if (!config.configured) {
    throw new DeployHostVerificationError(
      `S3 is not configured on this host: ${describeS3ConfigGap() ?? 'unknown configuration gap'} (#3268).`,
    );
  }

  const buckets = [
    ...new Set(
      [config.bucket, config.backupBucket].filter(
        (bucket): bucket is string =>
          typeof bucket === 'string' && bucket.length > 0,
      ),
    ),
  ];
  const { HeadBucketCommand } = await import('@aws-sdk/client-s3');

  for (const bucket of buckets) {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (err) {
      const error = err as {
        name?: string;
        Code?: string;
        $metadata?: { httpStatusCode?: number };
      };
      const code = error.Code || error.name || 'unknown error';
      const status = error.$metadata?.httpStatusCode
        ? ` (HTTP ${error.$metadata.httpStatusCode})`
        : '';
      throw new DeployHostVerificationError(
        `S3 bucket "${bucket}" is not reachable with the deployed credentials: ${code}${status}. ` +
          'Uploads or backups would fail while the app reports healthy (#3268).',
      );
    }
  }
}

export type DumpRoleCheck = (dbUrl: string) => Promise<void>;

/**
 * A pg_dump taken as the app role reads zero tenant rows under FORCE RLS and
 * still exits 0. The backup role is therefore a deploy-time fact, not a
 * nightly-only one.
 */
export async function assertBackupRole(
  env: NodeJS.ProcessEnv = process.env,
  check?: DumpRoleCheck,
): Promise<void> {
  const dbUrl = env['BACKUP_DATABASE_URL'] || env['DATABASE_URL'];
  if (!dbUrl) {
    throw new DeployHostVerificationError(
      'Neither BACKUP_DATABASE_URL nor DATABASE_URL is set; the backup role cannot be verified (#3268).',
    );
  }

  const verify =
    check ??
    (await import('../../lib/backups/backup-service.ts'))
      .assertDumpRoleCanReadAllTenants;
  try {
    await verify(dbUrl);
  } catch (err) {
    throw new DeployHostVerificationError(
      `Backup role check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export interface PreDeployDependencies {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  s3Config?: S3Config;
  s3Client?: BucketProbe;
  checkDumpRole?: DumpRoleCheck;
}

/** After checkout/install, before migrations or a build. */
export async function runPreDeployChecks(
  deps: PreDeployDependencies = {},
): Promise<void> {
  assertWorkingTreeClean(
    readGitStatus(deps.cwd ?? process.cwd()),
    'after checkout',
  );

  const config = deps.s3Config ?? getS3Config();
  const client: BucketProbe =
    deps.s3Client ??
    (await (
      await import('../../lib/storage/s3-client.ts')
    ).createS3Client(config));
  try {
    await assertBucketsReachable(config, client);
  } finally {
    client.destroy?.();
  }

  await assertBackupRole(deps.env ?? process.env, deps.checkDumpRole);
}

/** After `deploy_all_and_wait` has restarted every process. */
export function runPostDeployChecks(deps: { pm2Json?: string } = {}): void {
  assertPm2Apps(parsePm2List(deps.pm2Json ?? readPm2List()));
}
