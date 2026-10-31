/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3258 — an object write stops assuming its bucket exists.
 *
 * At `a32e14be0` the tree had three files that `PutObjectCommand` into a bucket and
 * zero that could create one (`grep -rn "CreateBucket" .` → nothing; the single
 * `HeadBucket` was the super-admin health panel, which reports and stops). This suite
 * pins the replacement, and in particular the two ways a naive version of it would be
 * worse than the bug:
 *
 * - A refused `HEAD` is not an absent bucket. The managed provider in #2054 answers
 *   `CreateBucket` with `AccessDenied`, and plenty of deployments may `PutObject` but
 *   not `HeadBucket` — a helper that read either refusal as "make one" (or as "fail")
 *   would break a working upload.
 * - `unverifiable` must not be cached. A bucket created while the process is running
 *   has to be seen without a restart, so only the two success states are memoised.
 *
 * The last group is the ratchet: a scan of the tree for object writers, so the fourth
 * one added later cannot skip the question again. It lives in a test rather than a
 * `guard:` alias because `ci.yml` is in flight under #3380 and #3335 — and the alias
 * census in `docs/README.md` counts every `guard:*` against a workflow step that
 * invokes it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

type Sent = { __type: string; Bucket?: string; Key?: string; Body?: unknown; CreateBucketConfiguration?: { LocationConstraint?: string } };

const h = vi.hoisted(() => ({
  sent: [] as Sent[],
  head: 'ok' as 'ok' | 'absent' | 'denied' | 'unreachable',
  create: 'ok' as 'ok' | 'denied' | 'owned',
  putBody: undefined as Uint8Array | undefined,
  signed: [] as Sent[],
}));

function awsError(name: string, httpStatusCode: number): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });
}

vi.mock('@aws-sdk/client-s3', () => {
  class Cmd {
    constructor(input: Record<string, unknown>) {
      Object.assign(this, input);
      (this as { __type?: string }).__type = new.target.name;
    }
  }
  return {
    S3Client: class {
      async send(command: unknown) {
        const c = command as Sent;
        h.sent.push(c);
        if (c.__type === 'HeadBucketCommand') {
          if (h.head === 'absent') throw awsError('NotFound', 404);
          if (h.head === 'denied') throw awsError('AccessDenied', 403);
          if (h.head === 'unreachable') throw new Error('connect ECONNREFUSED minio:9000');
          return {};
        }
        if (c.__type === 'CreateBucketCommand') {
          if (h.create === 'denied') throw awsError('AccessDenied', 403);
          if (h.create === 'owned') throw awsError('BucketAlreadyOwnedByYou', 409);
          return {};
        }
        if (c.__type === 'PutObjectCommand') {
          h.putBody = c.Body as Uint8Array;
          return {};
        }
        if (c.__type === 'GetObjectCommand') {
          return { Body: { transformToByteArray: async () => h.putBody ?? new Uint8Array() } };
        }
        if (c.__type === 'HeadObjectCommand') return { ContentLength: 12 };
        return {};
      }
    },
    HeadBucketCommand: class HeadBucketCommand extends Cmd {},
    CreateBucketCommand: class CreateBucketCommand extends Cmd {},
    PutObjectCommand: class PutObjectCommand extends Cmd {},
    GetObjectCommand: class GetObjectCommand extends Cmd {},
    HeadObjectCommand: class HeadObjectCommand extends Cmd {},
    DeleteObjectCommand: class DeleteObjectCommand extends Cmd {},
    ListObjectsV2Command: class ListObjectsV2Command extends Cmd {},
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async (_client: unknown, command: unknown) => {
    h.signed.push(command as Sent);
    return 'https://store/signed';
  }),
}));

const baseCfg = {
  configured: true,
  bucket: 'nucrm-user-files',
  backupBucket: 'nucrm-backups',
  region: 'us-east-1',
  endpoint: 'http://minio:9000',
  credentials: { accessKeyId: 'AKIA-FAKE-ACCESS-KEY', secretAccessKey: 'fake-secret-9f3a2b' },
  storageType: 's3' as const,
  resolvedFrom: { accessKeyId: 'S3_ACCESS_KEY_ID', secretAccessKey: 'S3_SECRET_KEY' },
};

vi.mock('@/lib/storage/s3-config', () => ({
  getS3Config: () => ({ ...baseCfg }),
  isS3Configured: () => true,
  describeS3ConfigGap: () => null,
}));

const types = () => h.sent.map((c) => c.__type);

let ensure: typeof import('@/lib/storage/ensure-bucket');

beforeEach(async () => {
  h.sent.length = 0;
  h.head = 'ok';
  h.create = 'ok';
  h.putBody = undefined;
  h.signed.length = 0;
  ensure = await import('@/lib/storage/ensure-bucket');
  ensure.resetBucketAssurance();
});

describe('ensureBucket (#3258)', () => {
  it('accepts a bucket the store already has, without creating anything', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3');
    const answer = await ensure.ensureBucket('nucrm-backups', { ...baseCfg }, new S3Client({}) as never);
    expect(answer).toEqual({ status: 'present' });
    expect(types()).toEqual(['HeadBucketCommand']);
  });

  it('creates the bucket the store positively says is absent', async () => {
    h.head = 'absent';
    const { S3Client } = await import('@aws-sdk/client-s3');
    const answer = await ensure.ensureBucket('nucrm-backups', { ...baseCfg }, new S3Client({}) as never);
    expect(answer).toEqual({ status: 'created' });
    expect(types()).toEqual(['HeadBucketCommand', 'CreateBucketCommand']);
    expect(h.sent[1]?.Bucket).toBe('nucrm-backups');
  });

  it('treats a REFUSED head as unknown, not absent — and never reaches CreateBucket', async () => {
    // The #2054 shape. A role that cannot HeadBucket is a normal deployment; if a
    // refusal read as absence, this helper would fire a doomed CreateBucket at every
    // upload on the managed provider, and if it read as fatal it would refuse
    // uploads that work today.
    h.head = 'denied';
    const { S3Client } = await import('@aws-sdk/client-s3');
    const answer = await ensure.ensureBucket('nucrm-backups', { ...baseCfg }, new S3Client({}) as never);
    expect(answer.status).toBe('unverifiable');
    expect(types()).toEqual(['HeadBucketCommand']);
  });

  it('throws an actionable error only when the bucket is absent AND the create is denied', async () => {
    h.head = 'absent';
    h.create = 'denied';
    const { S3Client } = await import('@aws-sdk/client-s3');
    await expect(ensure.ensureBucket('nucrm-backups', { ...baseCfg }, new S3Client({}) as never))
      .rejects.toBeInstanceOf(ensure.BucketProvisioningError);
    await expect(ensure.ensureBucket('other-bucket', { ...baseCfg }, new S3Client({}) as never))
      .rejects.toThrow(/storage:buckets/);
  });

  it('reads a 409 as "it exists" — a concurrent run is not a failure', async () => {
    h.head = 'absent';
    h.create = 'owned';
    const { S3Client } = await import('@aws-sdk/client-s3');
    await expect(ensure.ensureBucket('nucrm-backups', { ...baseCfg }, new S3Client({}) as never))
      .resolves.toEqual({ status: 'present' });
  });

  it('answers once per bucket for the life of the process, so a working store is probed once', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3');
    const client = new S3Client({}) as never;
    await ensure.ensureBucket('nucrm-backups', { ...baseCfg }, client);
    await ensure.ensureBucket('nucrm-backups', { ...baseCfg }, client);
    expect(types()).toEqual(['HeadBucketCommand']);
  });

  it('does NOT cache an unknown answer — a bucket created mid-process is seen without a restart', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3');
    const client = new S3Client({}) as never;
    h.head = 'unreachable';
    const first = await ensure.ensureBucket('nucrm-backups', { ...baseCfg }, client);
    expect(first.status).toBe('unverifiable');
    h.head = 'ok';
    await expect(ensure.ensureBucket('nucrm-backups', { ...baseCfg }, client)).resolves.toEqual({ status: 'present' });
    expect(types()).toEqual(['HeadBucketCommand', 'HeadBucketCommand']);
  });

  it('sends no request at all when S3 is not configured', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3');
    const answer = await ensure.ensureBucket('nucrm-backups', { ...baseCfg, configured: false }, new S3Client({}) as never);
    expect(answer.status).toBe('unverifiable');
    expect(h.sent).toEqual([]);
  });

  it('names a region in the create only where a region may be named', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3');
    h.head = 'absent';
    await ensure.ensureBucket('b1', { ...baseCfg, region: 'ap-south-1' }, new S3Client({}) as never);
    expect(h.sent[1]?.CreateBucketConfiguration).toEqual({ LocationConstraint: 'ap-south-1' });

    ensure.resetBucketAssurance();
    h.sent.length = 0;
    await ensure.ensureBucket('b2', { ...baseCfg, region: 'us-east-1' }, new S3Client({}) as never);
    // AWS rejects a LocationConstraint for us-east-1 outright.
    expect(h.sent[1]?.CreateBucketConfiguration).toBeUndefined();

    ensure.resetBucketAssurance();
    h.sent.length = 0;
    await ensure.ensureBucket('b3', { ...baseCfg, region: 'auto', endpoint: 'https://acct.r2.cloudflarestorage.com' }, new S3Client({}) as never);
    expect(h.sent[1]?.CreateBucketConfiguration).toBeUndefined();
  });
});

describe('the write paths ask before they write (#3258)', () => {
  it('uploadBackup probes the backup bucket before it puts the dump', async () => {
    const mod = await import('@/lib/storage/s3');
    await mod.uploadBackup(Buffer.from('dump'), 'nightly.sql');
    expect(types()).toEqual(['HeadBucketCommand', 'PutObjectCommand']);
  });

  it('uploadFileToS3 probes the bucket it is about to write to, not a hardcoded one', async () => {
    const mod = await import('@/lib/storage/s3');
    await mod.uploadFileToS3(Buffer.from('bytes'), 'documents/t/a.pdf', 'application/pdf', 'tenant-docs');
    expect(types()[0]).toBe('HeadBucketCommand');
    expect(h.sent[0]?.Bucket).toBe('tenant-docs');
  });

  it('getSignedPutUrl probes before signing, so the server reports a missing bucket instead of the browser', async () => {
    const mod = await import('@/lib/storage/s3');
    const url = await mod.getSignedPutUrl({ key: 'documents/t/a.pdf', contentType: 'application/pdf', contentLengthBytes: 1024, bucket: 'tenant-docs' });
    expect(url).toBe('https://store/signed');
    expect(types()).toEqual(['HeadBucketCommand']);
    expect(h.signed[0]?.__type).toBe('PutObjectCommand');
    expect(h.signed[0]?.Bucket).toBe('tenant-docs');
  });

  it('a refused probe does not stop the upload', async () => {
    h.head = 'denied';
    const mod = await import('@/lib/storage/s3');
    await expect(mod.uploadBackup(Buffer.from('dump'), 'nightly.sql')).resolves.toMatch(/nightly\.sql$/);
  });

  it('reads stay reads: headObjectSize never asks about the bucket', async () => {
    const mod = await import('@/lib/storage/s3');
    await mod.headObjectSize('documents/t/a.pdf', 'bkt');
    expect(types()).toEqual(['HeadObjectCommand']);
  });

  it('the nightly off-site upload probes before its PutObject too', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'nucrm-s3-3258-vm-'));
    writeFileSync(join(dir, 'nightly.sql'), 'dump');
    const { uploadBackupArtifact } = await import('@/lib/backups/offsite');
    const result = await uploadBackupArtifact({ localPath: join(dir, 'nightly.sql'), filename: 'nightly.sql' });
    expect(result.bucket).toBe('nucrm-backups');
    expect(types()).toEqual(['HeadBucketCommand', 'PutObjectCommand']);
  });
});

describe('the provisioning script (#3258)', () => {
  it('lists both configured buckets once, and nothing for an unset one', async () => {
    const script = await import('../../scripts/provision-s3-buckets.mts');
    expect(script.configuredBuckets({ ...baseCfg })).toEqual(['nucrm-user-files', 'nucrm-backups']);
    expect(script.configuredBuckets({ ...baseCfg, bucket: undefined, backupBucket: undefined })).toEqual([]);
    expect(script.configuredBuckets({ ...baseCfg }, ['nucrm-user-files', 'other'])).toEqual(['nucrm-user-files', 'nucrm-backups', 'other']);
  });

  it('reports each bucket and exits 0 when every one is writable', async () => {
    const script = await import('../../scripts/provision-s3-buckets.mts');
    const out: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => { out.push(String(chunk)); return true; }) as never);
    const { S3Client } = await import('@aws-sdk/client-s3');
    const code = await script.main(['--json'], () => new S3Client({}) as never);
    spy.mockRestore();
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join('')) as { ok: boolean; reports: { bucket: string; assurance: string; roundTrip: string }[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.reports.map((r) => r.bucket)).toEqual(['nucrm-user-files', 'nucrm-backups']);
    expect(parsed.reports.every((r) => r.roundTrip === 'ok')).toBe(true);
  });

  it('exits 1 and says what to do when a bucket is absent and uncreateable', async () => {
    const script = await import('../../scripts/provision-s3-buckets.mts');
    h.head = 'absent';
    h.create = 'denied';
    const out: string[] = [];
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => { out.push(String(chunk)); return true; }) as never);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { S3Client } = await import('@aws-sdk/client-s3');
    const code = await script.main(['--json'], () => new S3Client({}) as never);
    outSpy.mockRestore();
    errSpy.mockRestore();
    expect(code).toBe(1);
    const parsed = JSON.parse(out.join('')) as { ok: boolean; reports: { error?: string }[] };
    expect(parsed.ok).toBe(false);
    expect(parsed.reports[0]?.error).toMatch(/may not create it/);
  });

  it('never prints a credential value, only the names that supplied it', async () => {
    const script = await import('../../scripts/provision-s3-buckets.mts');
    const out: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => { out.push(String(chunk)); return true; }) as never);
    const { S3Client } = await import('@aws-sdk/client-s3');
    await script.main(['--json'], () => new S3Client({}) as never);
    spy.mockRestore();
    const text = out.join('');
    expect(text).toContain('S3_ACCESS_KEY_ID');
    expect(text).not.toContain('AKIA-FAKE-ACCESS-KEY');
    expect(text).not.toContain('fake-secret-9f3a2b');
  });
});

describe('the ratchet (#3258)', () => {
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === 'node_modules') continue;
        out.push(...walk(p));
      } else if (/\.(ts|tsx|mts)$/.test(name) && !/\.(test|stories)\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }

  it('every file that writes an object imports the assurance helper', () => {
    const writers = ['app', 'lib', 'scripts', 'components']
      .flatMap((d) => { try { return walk(d); } catch { return []; } })
      .filter((f) => readFileSync(f, 'utf8').includes('PutObjectCommand'));
    // Not vacuous: three existed when the issue was filed, and this PR wired all of them.
    expect(writers.length).toBeGreaterThanOrEqual(4);
    const unwired = writers.filter((f) => !readFileSync(f, 'utf8').includes('ensure-bucket'));
    expect(unwired).toEqual([]);
  });
});
