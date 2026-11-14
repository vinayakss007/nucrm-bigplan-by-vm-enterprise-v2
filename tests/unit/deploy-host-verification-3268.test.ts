/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3268 — the deploy host checks are the thing that makes host-local drift
 * loud. These tests pin the failure modes: a dirty working copy, a missing or
 * errored pm2 consumer, an unconfigured/unreachable bucket, and a backup role
 * that cannot read tenant rows.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assertBackupRole,
  assertBucketsReachable,
  assertPm2Apps,
  assertWorkingTreeClean,
  parsePm2List,
  type BucketProbe,
  type Pm2Process,
} from '../../scripts/lib/deploy-host-verification.mts';
import type { S3Config } from '@/lib/storage/s3-config';

const ROOT = join(__dirname, '..', '..');

function s3Config(overrides: Partial<S3Config> = {}): S3Config {
  return {
    credentials: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
    region: 'us-east-1',
    endpoint: 'http://127.0.0.1:9000',
    bucket: 'nucrm-files',
    backupBucket: 'nucrm-backups',
    configured: true,
    storageType: 's3',
    resolvedFrom: {
      accessKeyId: 'S3_ACCESS_KEY_ID',
      secretAccessKey: 'S3_SECRET_ACCESS_KEY',
    },
    ...overrides,
  };
}

function bucketClient(sent: string[]): BucketProbe {
  return {
    send: vi.fn(async (command: unknown) => {
      const input = (command as { input?: { Bucket?: string } }).input;
      if (input?.Bucket) sent.push(input.Bucket);
      return {};
    }),
    destroy: vi.fn(),
  };
}

function online(name: string): Pm2Process {
  return { name, status: 'online' };
}

describe('#3268 — a dirty deploy working copy is refused, not force-checked-out', () => {
  it('accepts a clean status', () => {
    expect(() => assertWorkingTreeClean('')).not.toThrow();
  });

  it('names every local change and the destructive checkout', () => {
    const status = [
      ' M app/api/tenant/deals/route.ts',
      '?? scripts/host-only-patch.sh',
    ].join('\n');

    expect(() => assertWorkingTreeClean(status, 'before checkout')).toThrow(
      /2 local change\(s\) before checkout/,
    );
    expect(() => assertWorkingTreeClean(status, 'before checkout')).toThrow(
      /git checkout --force/,
    );
    expect(() => assertWorkingTreeClean(status, 'before checkout')).toThrow(
      /host-only-patch\.sh/,
    );
  });

  it('runs the guard before the destructive checkout in deploy.yml', () => {
    const workflow = readFileSync(
      join(ROOT, '.github/workflows/deploy.yml'),
      'utf8',
    );
    const guard = workflow.indexOf('if [ -n "$(git status --porcelain)" ]');
    const checkout = workflow.indexOf('git checkout --force "$SHA"');

    expect(guard).toBeGreaterThan(-1);
    expect(checkout).toBeGreaterThan(guard);
    expect(workflow).toContain(
      'ABORT: the host working copy has local changes',
    );
  });
});

describe('#3268 — pm2 must have all four apps, not just a healthy web', () => {
  it('parses the JSON table even when pm2 prints a banner first', () => {
    const raw = [
      '[PM2] Spawning PM2 daemon with pm2_home=/home/deploy/.pm2',
      JSON.stringify([
        { name: 'web', pm2_env: { status: 'online' } },
        { name: 'worker', pm2_env: { status: 'online' } },
      ]),
    ].join('\n');

    expect(parsePm2List(raw)).toEqual([
      { name: 'web', status: 'online' },
      { name: 'worker', status: 'online' },
    ]);
  });

  it('rejects a non-JSON table instead of assuming it is healthy', () => {
    expect(() => parsePm2List('pm2: command not found')).toThrow(
      /did not return a JSON/,
    );
    expect(() => parsePm2List('[{"name":')).toThrow(/malformed JSON/);
    expect(() => parsePm2List('{"name":"web"}')).toThrow(
      /did not return a JSON/,
    );
  });

  it('accepts web and the nucrm-prod alias, plus the three consumers', () => {
    expect(() =>
      assertPm2Apps([
        online('web'),
        online('worker'),
        online('cron'),
        online('realtime'),
      ]),
    ).not.toThrow();
    expect(() =>
      assertPm2Apps([
        online('nucrm-prod'),
        online('worker'),
        online('cron'),
        online('realtime'),
      ]),
    ).not.toThrow();
  });

  it('fails when a consumer is missing, even if web is healthy', () => {
    expect(() =>
      assertPm2Apps([online('web'), online('worker'), online('cron')]),
    ).toThrow(/missing pm2 app: realtime/);
  });

  it('fails when a consumer exists but is errored', () => {
    expect(() =>
      assertPm2Apps([
        online('web'),
        online('worker'),
        { name: 'cron', status: 'errored' },
        online('realtime'),
      ]),
    ).toThrow(/cron is errored \(expected online\)/);
  });

  it('fails when no web process exists', () => {
    expect(() =>
      assertPm2Apps([online('worker'), online('cron'), online('realtime')]),
    ).toThrow(/missing pm2 app: one of web \/ nucrm-prod/);
  });

  it('is wired into the deploy after the restart', () => {
    const workflow = readFileSync(
      join(ROOT, '.github/workflows/deploy.yml'),
      'utf8',
    );
    expect(workflow).toContain('verify-deploy-host.mts --phase post');
    expect(workflow).toContain('bg_gate || return 1');
  });
});

describe('#3268 — S3 buckets must answer HeadBucket', () => {
  it('checks the user bucket and the backup bucket', async () => {
    const sent: string[] = [];
    await assertBucketsReachable(s3Config(), bucketClient(sent));
    expect(sent).toEqual(['nucrm-files', 'nucrm-backups']);
  });

  it('does not check the same bucket twice when backups share it', async () => {
    const sent: string[] = [];
    await assertBucketsReachable(
      s3Config({ backupBucket: 'nucrm-files' }),
      bucketClient(sent),
    );
    expect(sent).toEqual(['nucrm-files']);
  });

  it('fails when S3 is not configured, naming the missing variables', async () => {
    await expect(
      assertBucketsReachable(
        s3Config({
          configured: false,
          bucket: undefined,
          backupBucket: undefined,
          credentials: { accessKeyId: '', secretAccessKey: '' },
        }),
        bucketClient([]),
      ),
    ).rejects.toThrow(/S3 is not configured.*S3_BUCKET/);
  });

  it('fails when a bucket is absent or the role cannot read it', async () => {
    const client: BucketProbe = {
      send: vi.fn(async () => {
        throw Object.assign(new Error('no such bucket'), {
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 },
        });
      }),
    };

    await expect(assertBucketsReachable(s3Config(), client)).rejects.toThrow(
      /bucket "nucrm-files" is not reachable.*NotFound \(HTTP 404\)/,
    );
  });
});

describe('#3268 — the backup role must be able to read every tenant', () => {
  it('prefers BACKUP_DATABASE_URL over the app role', async () => {
    const check = vi.fn(async () => undefined);
    await assertBackupRole(
      {
        BACKUP_DATABASE_URL: 'postgres://backup@db.example/nucrm',
        DATABASE_URL: 'postgres://app@db.example/nucrm',
      },
      check,
    );

    expect(check).toHaveBeenCalledWith('postgres://backup@db.example/nucrm');
  });

  it('fails when neither connection string exists', async () => {
    await expect(assertBackupRole({}, vi.fn())).rejects.toThrow(
      /Neither BACKUP_DATABASE_URL nor DATABASE_URL/,
    );
  });

  it('surfaces the refusal instead of letting the deploy continue', async () => {
    const check = vi.fn(async () => {
      throw new Error(
        'Backup refused: role "nucrm_app" is neither superuser nor BYPASSRLS',
      );
    });

    await expect(
      assertBackupRole(
        { DATABASE_URL: 'postgres://app@db.example/nucrm' },
        check,
      ),
    ).rejects.toThrow(/Backup role check failed: Backup refused/);
  });

  it('is wired into the deploy before the build', () => {
    const workflow = readFileSync(
      join(ROOT, '.github/workflows/deploy.yml'),
      'utf8',
    );
    expect(workflow).toContain('verify-deploy-host.mts --phase pre');
    expect(workflow).toContain('Nothing was migrated, built or restarted');
  });
});

describe('#3268 — the helper is reachable from npm', () => {
  it('declares deploy:verify-host', () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, 'package.json'), 'utf8'),
    ) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.['deploy:verify-host']).toContain(
      'scripts/verify-deploy-host.mts',
    );
    expect(pkg.scripts?.['deploy:verify-host']).toContain(
      './scripts/load-env.mjs',
    );
  });
});
