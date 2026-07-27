import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getS3Config,
  isS3Configured,
  describeS3ConfigGap,
} from '@/lib/storage/s3-config';

const S3_VARS = [
  'S3_ACCESS_KEY_ID',
  'S3_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_SECRET_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'S3_BUCKET',
  'BACKUP_BUCKET',
  'S3_REGION',
  'S3_ENDPOINT',
] as const;

describe('S3 configuration resolution', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const v of S3_VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
  });

  afterEach(() => {
    for (const v of S3_VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  // This is the regression that mattered: docker-compose.yml exports
  // S3_ACCESS_KEY / S3_SECRET_KEY, while the backup code read
  // S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY. The mismatch made the upload
  // branch unreachable, so backups silently never left the container.
  it('accepts the S3_ACCESS_KEY / S3_SECRET_KEY names used by docker-compose', () => {
    process.env.S3_ACCESS_KEY = 'compose-access';
    process.env.S3_SECRET_KEY = 'compose-secret';
    process.env.S3_BUCKET = 'nucrm-files';

    const cfg = getS3Config();
    expect(cfg.configured).toBe(true);
    expect(cfg.credentials.accessKeyId).toBe('compose-access');
    expect(cfg.credentials.secretAccessKey).toBe('compose-secret');
    expect(isS3Configured()).toBe(true);
    expect(describeS3ConfigGap()).toBeNull();
  });

  it('accepts the AWS-style names', () => {
    process.env.S3_ACCESS_KEY_ID = 'aws-access';
    process.env.S3_SECRET_ACCESS_KEY = 'aws-secret';
    process.env.S3_BUCKET = 'bucket';

    const cfg = getS3Config();
    expect(cfg.configured).toBe(true);
    expect(cfg.resolvedFrom.accessKeyId).toBe('S3_ACCESS_KEY_ID');
  });

  it('prefers the canonical name when several are present', () => {
    process.env.S3_ACCESS_KEY_ID = 'canonical';
    process.env.S3_ACCESS_KEY = 'alias';
    process.env.AWS_ACCESS_KEY_ID = 'aws';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';
    process.env.S3_BUCKET = 'bucket';

    expect(getS3Config().credentials.accessKeyId).toBe('canonical');
  });

  it('falls back to AWS_* when no S3_* credentials are set', () => {
    process.env.AWS_ACCESS_KEY_ID = 'aws-access';
    process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret';
    process.env.S3_BUCKET = 'bucket';

    const cfg = getS3Config();
    expect(cfg.configured).toBe(true);
    expect(cfg.resolvedFrom.accessKeyId).toBe('AWS_ACCESS_KEY_ID');
    expect(cfg.resolvedFrom.secretAccessKey).toBe('AWS_SECRET_ACCESS_KEY');
  });

  describe('incomplete configuration', () => {
    it('is not configured when nothing is set', () => {
      expect(isS3Configured()).toBe(false);
      expect(describeS3ConfigGap()).toContain('S3_BUCKET');
    });

    // Partial config must count as "not configured": otherwise an S3 client is
    // built with empty-string credentials and fails only at upload time.
    it('is not configured when the secret is missing', () => {
      process.env.S3_ACCESS_KEY = 'access';
      process.env.S3_BUCKET = 'bucket';

      expect(isS3Configured()).toBe(false);
      expect(describeS3ConfigGap()).toContain('S3_SECRET_ACCESS_KEY');
    });

    it('is not configured when the bucket is missing', () => {
      process.env.S3_ACCESS_KEY = 'access';
      process.env.S3_SECRET_KEY = 'secret';

      expect(isS3Configured()).toBe(false);
      expect(describeS3ConfigGap()).toContain('S3_BUCKET');
    });

    it('treats blank and whitespace-only values as unset', () => {
      process.env.S3_ACCESS_KEY = '   ';
      process.env.S3_SECRET_KEY = '';
      process.env.S3_BUCKET = 'bucket';

      expect(isS3Configured()).toBe(false);
    });
  });

  describe('bucket resolution', () => {
    it('uses BACKUP_BUCKET for backups when set', () => {
      process.env.S3_ACCESS_KEY = 'a';
      process.env.S3_SECRET_KEY = 'b';
      process.env.S3_BUCKET = 'files';
      process.env.BACKUP_BUCKET = 'backups';

      const cfg = getS3Config();
      expect(cfg.bucket).toBe('files');
      expect(cfg.backupBucket).toBe('backups');
    });

    it('falls back to S3_BUCKET when BACKUP_BUCKET is unset', () => {
      process.env.S3_ACCESS_KEY = 'a';
      process.env.S3_SECRET_KEY = 'b';
      process.env.S3_BUCKET = 'files';

      expect(getS3Config().backupBucket).toBe('files');
    });
  });

  describe('region and provider defaults', () => {
    it('defaults to "auto" for Cloudflare R2 endpoints', () => {
      process.env.S3_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
      const cfg = getS3Config();
      expect(cfg.region).toBe('auto');
      expect(cfg.storageType).toBe('s3_r2');
    });

    it('defaults to us-east-1 for plain S3', () => {
      const cfg = getS3Config();
      expect(cfg.region).toBe('us-east-1');
      expect(cfg.storageType).toBe('s3');
    });

    it('always honours an explicit S3_REGION', () => {
      process.env.S3_REGION = 'eu-west-2';
      process.env.S3_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
      expect(getS3Config().region).toBe('eu-west-2');
    });
  });

  it('re-reads the environment on every call', () => {
    expect(isS3Configured()).toBe(false);

    process.env.S3_ACCESS_KEY = 'a';
    process.env.S3_SECRET_KEY = 'b';
    process.env.S3_BUCKET = 'c';

    expect(isS3Configured()).toBe(true);
  });
});
