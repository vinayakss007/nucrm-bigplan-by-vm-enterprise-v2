import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Records every command handed to S3Client.send(), in order. */
const sent: { type: string; input: Record<string, unknown> }[] = [];

/** Pages returned by ListObjectsV2, consumed one call at a time. */
let listPages: {
  Contents?: { Key?: string; LastModified?: Date }[];
  IsTruncated?: boolean;
  NextContinuationToken?: string;
}[] = [];

let putShouldThrow: Error | null = null;

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    static type = 'unknown';
    input: Record<string, unknown>;
    type: string;
    constructor(input: Record<string, unknown>) {
      this.input = input;
      this.type = (this.constructor as typeof Command).type;
    }
  }
  class PutObjectCommand extends Command { static override type = 'put'; }
  class ListObjectsV2Command extends Command { static override type = 'list'; }
  class DeleteObjectsCommand extends Command { static override type = 'delete'; }

  class S3Client {
    constructor(public config: Record<string, unknown>) {}
    async send(cmd: Command) {
      sent.push({ type: cmd.type, input: cmd.input });
      if (cmd.type === 'put') {
        if (putShouldThrow) throw putShouldThrow;
        return {};
      }
      if (cmd.type === 'list') {
        return listPages.shift() ?? { Contents: [], IsTruncated: false };
      }
      return {};
    }
  }

  return { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand };
});

vi.mock('fs/promises', () => ({
  readFile: vi.fn(async () => Buffer.from('dump-bytes')),
  writeFile: vi.fn(async () => undefined),
}));

const ENV_VARS = [
  'S3_ACCESS_KEY_ID', 'S3_ACCESS_KEY', 'AWS_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY', 'S3_SECRET_KEY', 'AWS_SECRET_ACCESS_KEY',
  'S3_BUCKET', 'BACKUP_BUCKET', 'S3_REGION', 'S3_ENDPOINT',
] as const;

describe('off-site backup storage', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    sent.length = 0;
    listPages = [];
    putShouldThrow = null;
    saved = {};
    for (const v of ENV_VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
  });

  afterEach(() => {
    for (const v of ENV_VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  function configure(extra: Record<string, string> = {}) {
    process.env.S3_ACCESS_KEY = 'access';
    process.env.S3_SECRET_KEY = 'secret';
    process.env.S3_BUCKET = 'nucrm-files';
    Object.assign(process.env, extra);
  }

  describe('uploadBackupArtifact', () => {
    it('uploads under the backups/ prefix and reports the storage type', async () => {
      configure();
      const { uploadBackupArtifact } = await import('@/lib/backups/offsite');

      const result = await uploadBackupArtifact({
        localPath: '/tmp/nucrm_full.dump',
        filename: 'nucrm_full.dump',
        checksum: 'abc123',
      });

      expect(result.storagePath).toBe('backups/nucrm_full.dump');
      expect(result.storageType).toBe('s3');
      expect(result.bucket).toBe('nucrm-files');

      const put = sent.find((s) => s.type === 'put');
      expect(put?.input.Bucket).toBe('nucrm-files');
      expect(put?.input.Key).toBe('backups/nucrm_full.dump');
      // The digest travels with the object so it can be cross-checked even if
      // the database record is lost.
      expect(put?.input.Metadata).toEqual({ 'content-sha256': 'abc123' });
    });

    it('targets BACKUP_BUCKET when one is configured', async () => {
      configure({ BACKUP_BUCKET: 'nucrm-backups' });
      const { uploadBackupArtifact } = await import('@/lib/backups/offsite');

      const result = await uploadBackupArtifact({
        localPath: '/tmp/x.dump',
        filename: 'x.dump',
      });

      expect(result.bucket).toBe('nucrm-backups');
      expect(sent.find((s) => s.type === 'put')?.input.Bucket).toBe('nucrm-backups');
    });

    it('reports r2 storage type for Cloudflare endpoints', async () => {
      configure({ S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com' });
      const { uploadBackupArtifact } = await import('@/lib/backups/offsite');

      const result = await uploadBackupArtifact({ localPath: '/tmp/x.dump', filename: 'x.dump' });
      expect(result.storageType).toBe('s3_r2');
    });

    // Must reject rather than resolve, so the caller cannot record an off-site
    // backup that does not exist.
    it('throws when S3 is not configured, without attempting an upload', async () => {
      const { uploadBackupArtifact, OffsiteUploadError } = await import('@/lib/backups/offsite');

      await expect(
        uploadBackupArtifact({ localPath: '/tmp/x.dump', filename: 'x.dump' })
      ).rejects.toThrow(OffsiteUploadError);

      expect(sent).toHaveLength(0);
    });

    it('propagates an upload failure', async () => {
      configure();
      putShouldThrow = new Error('AccessDenied');
      const { uploadBackupArtifact } = await import('@/lib/backups/offsite');

      await expect(
        uploadBackupArtifact({ localPath: '/tmp/x.dump', filename: 'x.dump' })
      ).rejects.toThrow('AccessDenied');
    });
  });

  describe('purgeExpiredBackups', () => {
    const old = new Date(Date.now() - 60 * 86_400_000);
    const recent = new Date(Date.now() - 1 * 86_400_000);

    // The regression this guards: the previous implementation listed keys from
    // S3_BUCKET but issued the DeleteObjects against BACKUP_BUCKET. When the two
    // differed it deleted from the wrong bucket.
    it('lists and deletes from the same bucket', async () => {
      configure({ BACKUP_BUCKET: 'nucrm-backups' });
      listPages = [{
        Contents: [{ Key: 'backups/old.dump', LastModified: old }],
        IsTruncated: false,
      }];

      const { purgeExpiredBackups } = await import('@/lib/backups/offsite');
      const result = await purgeExpiredBackups(30);

      const list = sent.find((s) => s.type === 'list');
      const del = sent.find((s) => s.type === 'delete');

      expect(list?.input.Bucket).toBe('nucrm-backups');
      expect(del?.input.Bucket).toBe('nucrm-backups');
      expect(del?.input.Bucket).toBe(list?.input.Bucket);
      expect(result.deleted).toBe(1);
      expect(result.bucket).toBe('nucrm-backups');
    });

    // The sharpest form of the wrong-bucket regression: with BACKUP_BUCKET
    // unset, the old code sent `Bucket: undefined` to DeleteObjects and the
    // resulting error was swallowed, so retention silently never ran at all.
    it('deletes from S3_BUCKET when BACKUP_BUCKET is unset', async () => {
      configure();
      expect(process.env.BACKUP_BUCKET).toBeUndefined();

      listPages = [{
        Contents: [{ Key: 'backups/old.dump', LastModified: old }],
        IsTruncated: false,
      }];

      const { purgeExpiredBackups } = await import('@/lib/backups/offsite');
      const result = await purgeExpiredBackups(30);

      const list = sent.find((s) => s.type === 'list');
      const del = sent.find((s) => s.type === 'delete');

      expect(list?.input.Bucket).toBe('nucrm-files');
      expect(del?.input.Bucket).toBe('nucrm-files');
      expect(result.bucket).toBe('nucrm-files');
      expect(result.deleted).toBe(1);
    });

    it('only deletes objects older than the retention window', async () => {
      configure();
      listPages = [{
        Contents: [
          { Key: 'backups/old.dump', LastModified: old },
          { Key: 'backups/recent.dump', LastModified: recent },
        ],
        IsTruncated: false,
      }];

      const { purgeExpiredBackups } = await import('@/lib/backups/offsite');
      const result = await purgeExpiredBackups(30);

      expect(result.deleted).toBe(1);
      const del = sent.find((s) => s.type === 'delete');
      expect(del?.input.Bucket).toBe('nucrm-files');
      expect(del?.input.Delete).toEqual({
        Objects: [{ Key: 'backups/old.dump' }],
      });
    });

    it('issues no delete when nothing has expired', async () => {
      configure();
      listPages = [{ Contents: [{ Key: 'backups/recent.dump', LastModified: recent }], IsTruncated: false }];

      const { purgeExpiredBackups } = await import('@/lib/backups/offsite');
      const result = await purgeExpiredBackups(30);

      expect(result.deleted).toBe(0);
      expect(sent.some((s) => s.type === 'delete')).toBe(false);
    });

    // ListObjectsV2 caps at 1000 keys; an unpaginated implementation would stop
    // purging once the prefix grew past that and retention would quietly stall.
    it('follows pagination across truncated pages', async () => {
      configure();
      listPages = [
        {
          Contents: [{ Key: 'backups/p1.dump', LastModified: old }],
          IsTruncated: true,
          NextContinuationToken: 'token-2',
        },
        {
          Contents: [{ Key: 'backups/p2.dump', LastModified: old }],
          IsTruncated: false,
        },
      ];

      const { purgeExpiredBackups } = await import('@/lib/backups/offsite');
      const result = await purgeExpiredBackups(30);

      const lists = sent.filter((s) => s.type === 'list');
      expect(lists).toHaveLength(2);
      expect(lists[1]?.input.ContinuationToken).toBe('token-2');
      expect(result.deleted).toBe(2);
    });

    it('throws when S3 is not configured', async () => {
      const { purgeExpiredBackups, OffsiteUploadError } = await import('@/lib/backups/offsite');
      await expect(purgeExpiredBackups(30)).rejects.toThrow(OffsiteUploadError);
      expect(sent).toHaveLength(0);
    });
  });

  describe('resolveRetentionDays', () => {
    const RETENTION_VARS = ['BACKUP_RETENTION_DAYS', 'BACKUP_KEEP_DAYS'] as const;
    let savedRetention: Record<string, string | undefined>;

    beforeEach(() => {
      savedRetention = {};
      for (const v of RETENTION_VARS) {
        savedRetention[v] = process.env[v];
        delete process.env[v];
      }
    });

    afterEach(() => {
      for (const v of RETENTION_VARS) {
        if (savedRetention[v] === undefined) delete process.env[v];
        else process.env[v] = savedRetention[v];
      }
    });

    it('defaults to 30 days', async () => {
      const { resolveRetentionDays, DEFAULT_RETENTION_DAYS } = await import('@/lib/backups/offsite');
      expect(resolveRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);
      expect(resolveRetentionDays()).toBe(30);
    });

    it('reads the canonical BACKUP_RETENTION_DAYS', async () => {
      process.env.BACKUP_RETENTION_DAYS = '90';
      const { resolveRetentionDays } = await import('@/lib/backups/offsite');
      expect(resolveRetentionDays()).toBe(90);
    });

    // .env.example documented this name while the cron route read the other, so
    // an operator following the docs silently had no effect on retention.
    it('accepts BACKUP_KEEP_DAYS as an alias', async () => {
      process.env.BACKUP_KEEP_DAYS = '7';
      const { resolveRetentionDays } = await import('@/lib/backups/offsite');
      expect(resolveRetentionDays()).toBe(7);
    });

    it('prefers the canonical name when both are set', async () => {
      process.env.BACKUP_RETENTION_DAYS = '90';
      process.env.BACKUP_KEEP_DAYS = '7';
      const { resolveRetentionDays } = await import('@/lib/backups/offsite');
      expect(resolveRetentionDays()).toBe(90);
    });

    // A typo must not silently widen or collapse the retention window.
    it.each(['abc', '0', '-5', '7.5', ''])(
      'falls back to the default for invalid value %j',
      async (value) => {
        process.env.BACKUP_RETENTION_DAYS = value;
        const { resolveRetentionDays } = await import('@/lib/backups/offsite');
        expect(resolveRetentionDays()).toBe(30);
      }
    );
  });
});
