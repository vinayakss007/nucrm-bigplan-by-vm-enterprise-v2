/**
 * Unit tests for lib/storage/s3-config.ts
 *
 * This module exists because a truthiness check on the wrong env var names made
 * off-site backup upload unreachable: backups stayed inside an ephemeral
 * container while `backup_records.status` said 'completed'. Every branch of the
 * resolution logic is therefore pinned here.
 *
 * Companion suite: tests/unit/backups/s3-config.test.ts covers credential
 * aliasing, canonical precedence, the AWS_* fallback, whitespace-only values,
 * BACKUP_BUCKET vs S3_BUCKET, region defaults and per-call env re-reads. This
 * file deliberately does NOT repeat those; it covers the reporting path
 * (describeS3ConfigGap), value trimming, endpoint/R2 detection edge cases and
 * the partially-configured combinations that silently disable uploads.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getS3Config, isS3Configured, describeS3ConfigGap } from '@/lib/storage/s3-config';

const MANAGED_VARS = [
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

const ACCESS_KEY_NAMES = 'S3_ACCESS_KEY_ID | S3_ACCESS_KEY | AWS_ACCESS_KEY_ID';
const SECRET_KEY_NAMES = 'S3_SECRET_ACCESS_KEY | S3_SECRET_KEY | AWS_SECRET_ACCESS_KEY';

describe('lib/storage/s3-config', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    // Snapshot and clear so no ambient .env value leaks into an assertion, and
    // so nothing this test sets leaks into the next one.
    saved = {};
    for (const name of MANAGED_VARS) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of MANAGED_VARS) {
      const value = saved[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const setComplete = (): void => {
    process.env.S3_ACCESS_KEY_ID = 'access';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';
    process.env.S3_BUCKET = 'bucket';
  };

  describe('required vs optional variables', () => {
    it('requires exactly a bucket, an access key and a secret key', () => {
      setComplete();
      expect(isS3Configured()).toBe(true);
      expect(describeS3ConfigGap()).toBeNull();
    });

    it('does not require S3_REGION, S3_ENDPOINT or BACKUP_BUCKET', () => {
      setComplete();
      const cfg = getS3Config();
      expect(cfg.configured).toBe(true);
      expect(cfg.endpoint).toBeUndefined();
      expect(cfg.region).toBe('us-east-1');
      expect(cfg.backupBucket).toBe('bucket');
    });

    it.each([
      ['S3_BUCKET', () => { delete process.env.S3_BUCKET; }],
      ['access key', () => { delete process.env.S3_ACCESS_KEY_ID; }],
      ['secret key', () => { delete process.env.S3_SECRET_ACCESS_KEY; }],
    ])('is not configured when %s is absent', (_label, remove) => {
      setComplete();
      remove();
      expect(isS3Configured()).toBe(false);
      expect(describeS3ConfigGap()).not.toBeNull();
    });

    it('is not configured when only an endpoint and region are set', () => {
      process.env.S3_ENDPOINT = 'https://minio.internal:9000';
      process.env.S3_REGION = 'eu-central-1';
      expect(isS3Configured()).toBe(false);
    });

    it('keeps isS3Configured in agreement with getS3Config().configured', () => {
      expect(isS3Configured()).toBe(getS3Config().configured);
      setComplete();
      expect(isS3Configured()).toBe(getS3Config().configured);
    });
  });

  describe('describeS3ConfigGap reporting', () => {
    it('returns null once configuration is complete', () => {
      setComplete();
      expect(describeS3ConfigGap()).toBeNull();
    });

    it('lists the bucket and BOTH credential alias groups when nothing is set', () => {
      expect(describeS3ConfigGap()).toBe(
        'S3 storage not configured; missing: S3_BUCKET, ' +
          `one of ${ACCESS_KEY_NAMES}, one of ${SECRET_KEY_NAMES}`
      );
    });

    it('names every accepted access-key alias so operators can fix naming drift', () => {
      const gap = describeS3ConfigGap() ?? '';
      for (const name of ['S3_ACCESS_KEY_ID', 'S3_ACCESS_KEY', 'AWS_ACCESS_KEY_ID']) {
        expect(gap).toContain(name);
      }
    });

    it('names every accepted secret-key alias', () => {
      const gap = describeS3ConfigGap() ?? '';
      for (const name of ['S3_SECRET_ACCESS_KEY', 'S3_SECRET_KEY', 'AWS_SECRET_ACCESS_KEY']) {
        expect(gap).toContain(name);
      }
    });

    it('reports only the bucket when the credentials are present', () => {
      process.env.S3_ACCESS_KEY = 'a';
      process.env.S3_SECRET_KEY = 'b';
      expect(describeS3ConfigGap()).toBe('S3 storage not configured; missing: S3_BUCKET');
    });

    it('reports only the secret group when bucket and access key are present', () => {
      process.env.S3_ACCESS_KEY = 'a';
      process.env.S3_BUCKET = 'bucket';
      expect(describeS3ConfigGap()).toBe(
        `S3 storage not configured; missing: one of ${SECRET_KEY_NAMES}`
      );
    });

    it('reports only the access group when bucket and secret are present', () => {
      process.env.AWS_SECRET_ACCESS_KEY = 'b';
      process.env.S3_BUCKET = 'bucket';
      expect(describeS3ConfigGap()).toBe(
        `S3 storage not configured; missing: one of ${ACCESS_KEY_NAMES}`
      );
    });

    it('reports S3_BUCKET (not BACKUP_BUCKET) even when only BACKUP_BUCKET is set', () => {
      process.env.S3_ACCESS_KEY = 'a';
      process.env.S3_SECRET_KEY = 'b';
      process.env.BACKUP_BUCKET = 'backups-only';
      expect(describeS3ConfigGap()).toBe('S3 storage not configured; missing: S3_BUCKET');
    });

    it('keeps the missing list in bucket, access, secret order', () => {
      const gap = describeS3ConfigGap() ?? '';
      expect(gap.indexOf('S3_BUCKET')).toBeLessThan(gap.indexOf(`one of ${ACCESS_KEY_NAMES}`));
      expect(gap.indexOf(`one of ${ACCESS_KEY_NAMES}`)).toBeLessThan(
        gap.indexOf(`one of ${SECRET_KEY_NAMES}`)
      );
    });
  });

  describe('whitespace trimming', () => {
    it('trims padded credential values', () => {
      process.env.S3_ACCESS_KEY_ID = '  access  ';
      process.env.S3_SECRET_ACCESS_KEY = '\tsecret\n';
      process.env.S3_BUCKET = 'bucket';

      const cfg = getS3Config();
      expect(cfg.credentials).toEqual({ accessKeyId: 'access', secretAccessKey: 'secret' });
      expect(cfg.configured).toBe(true);
    });

    it('trims the bucket names', () => {
      setComplete();
      process.env.S3_BUCKET = '  files  ';
      process.env.BACKUP_BUCKET = '\tbackups ';

      const cfg = getS3Config();
      expect(cfg.bucket).toBe('files');
      expect(cfg.backupBucket).toBe('backups');
    });

    it('trims the region and the endpoint', () => {
      setComplete();
      process.env.S3_REGION = '  eu-west-1  ';
      process.env.S3_ENDPOINT = '  https://minio.internal:9000  ';

      const cfg = getS3Config();
      expect(cfg.region).toBe('eu-west-1');
      expect(cfg.endpoint).toBe('https://minio.internal:9000');
    });

    it('falls back to the default region when S3_REGION is whitespace only', () => {
      setComplete();
      process.env.S3_REGION = '   ';
      expect(getS3Config().region).toBe('us-east-1');
    });

    it('treats a whitespace-only endpoint as unset', () => {
      setComplete();
      process.env.S3_ENDPOINT = '   ';
      const cfg = getS3Config();
      expect(cfg.endpoint).toBeUndefined();
      expect(cfg.storageType).toBe('s3');
    });

    it('skips a whitespace-only alias and uses the next populated one', () => {
      process.env.S3_ACCESS_KEY_ID = '   ';
      process.env.S3_ACCESS_KEY = 'from-alias';
      process.env.S3_SECRET_ACCESS_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      const cfg = getS3Config();
      expect(cfg.credentials.accessKeyId).toBe('from-alias');
      expect(cfg.resolvedFrom.accessKeyId).toBe('S3_ACCESS_KEY');
    });
  });

  describe('bucket fallback', () => {
    it('falls back to S3_BUCKET when BACKUP_BUCKET is whitespace only', () => {
      setComplete();
      process.env.S3_BUCKET = 'files';
      process.env.BACKUP_BUCKET = '   ';
      expect(getS3Config().backupBucket).toBe('files');
    });

    it('leaves both buckets undefined when neither is set', () => {
      const cfg = getS3Config();
      expect(cfg.bucket).toBeUndefined();
      expect(cfg.backupBucket).toBeUndefined();
    });

    it('DESIGN TRAP: BACKUP_BUCKET alone resolves a backup bucket but reports NOT configured', () => {
      // Setting only BACKUP_BUCKET looks sufficient for backups, yet
      // `configured` keys off `bucket`, so every off-site upload guarded by
      // isS3Configured() is skipped while backupBucket is populated.
      process.env.S3_ACCESS_KEY = 'a';
      process.env.S3_SECRET_KEY = 'b';
      process.env.BACKUP_BUCKET = 'backups-only';

      const cfg = getS3Config();
      expect(cfg.backupBucket).toBe('backups-only');
      expect(cfg.bucket).toBeUndefined();
      expect(cfg.configured).toBe(false);
    });
  });

  describe('endpoint and R2 detection', () => {
    it('does not force the R2 region for a non-R2 custom endpoint', () => {
      setComplete();
      process.env.S3_ENDPOINT = 'https://minio.internal:9000';
      const cfg = getS3Config();
      expect(cfg.storageType).toBe('s3');
      expect(cfg.region).toBe('us-east-1');
    });

    it('detects R2 anywhere in the endpoint string', () => {
      setComplete();
      process.env.S3_ENDPOINT = 'https://abc123.r2.cloudflarestorage.com';
      expect(getS3Config().storageType).toBe('s3_r2');
    });

    it('CAVEAT: R2 detection is a case-sensitive substring match', () => {
      // An uppercase host silently falls back to the AWS default region, which
      // R2 rejects; and an unrelated host containing "r2" is misdetected.
      setComplete();
      process.env.S3_ENDPOINT = 'https://abc123.R2.cloudflarestorage.com';
      expect(getS3Config().storageType).toBe('s3');
      expect(getS3Config().region).toBe('us-east-1');

      process.env.S3_ENDPOINT = 'https://minio-r2d2.internal:9000';
      expect(getS3Config().storageType).toBe('s3_r2');
      expect(getS3Config().region).toBe('auto');
    });
  });

  describe('resolvedFrom diagnostics', () => {
    it('is null for both credentials when none are present', () => {
      expect(getS3Config().resolvedFrom).toEqual({
        accessKeyId: null,
        secretAccessKey: null,
      });
    });

    it('reports each credential source independently when they come from different aliases', () => {
      process.env.S3_ACCESS_KEY = 'compose-access';
      process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret';
      process.env.S3_BUCKET = 'bucket';

      const cfg = getS3Config();
      expect(cfg.resolvedFrom).toEqual({
        accessKeyId: 'S3_ACCESS_KEY',
        secretAccessKey: 'AWS_SECRET_ACCESS_KEY',
      });
      expect(cfg.configured).toBe(true);
    });

    it('prefers the canonical secret name over its aliases', () => {
      process.env.S3_SECRET_ACCESS_KEY = 'canonical';
      process.env.S3_SECRET_KEY = 'alias';
      process.env.AWS_SECRET_ACCESS_KEY = 'aws';
      process.env.S3_ACCESS_KEY_ID = 'access';
      process.env.S3_BUCKET = 'bucket';

      const cfg = getS3Config();
      expect(cfg.credentials.secretAccessKey).toBe('canonical');
      expect(cfg.resolvedFrom.secretAccessKey).toBe('S3_SECRET_ACCESS_KEY');
    });

    it('reports the source even when the overall config is incomplete', () => {
      process.env.S3_ACCESS_KEY = 'orphan';
      const cfg = getS3Config();
      expect(cfg.configured).toBe(false);
      expect(cfg.resolvedFrom.accessKeyId).toBe('S3_ACCESS_KEY');
      expect(cfg.resolvedFrom.secretAccessKey).toBeNull();
    });
  });

  it('never returns undefined credential strings, so the S3 client always gets strings', () => {
    const cfg = getS3Config();
    expect(cfg.credentials.accessKeyId).toBe('');
    expect(cfg.credentials.secretAccessKey).toBe('');
  });
});
