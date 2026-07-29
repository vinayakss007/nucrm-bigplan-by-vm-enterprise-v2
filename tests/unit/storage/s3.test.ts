/**
 * Unit tests for lib/storage/s3.ts
 *
 * The S3 client and target bucket are resolved once at module load, so each
 * test re-imports the module with a fresh environment. The AWS SDK is mocked;
 * what is asserted is the bucket/key/params this module sends, because a wrong
 * bucket or prefix means backups are written somewhere nobody looks for them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';

type CommandInput = Record<string, unknown>;

const awsMocks = vi.hoisted(() => ({
  send: vi.fn(),
  presign: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => {
  class BaseCommand {
    constructor(public readonly input: CommandInput) {}
  }
  return {
    S3Client: vi.fn().mockImplementation((config: CommandInput) => ({
      config,
      send: awsMocks.send,
    })),
    PutObjectCommand: class PutObjectCommand extends BaseCommand {},
    GetObjectCommand: class GetObjectCommand extends BaseCommand {},
    ListObjectsV2Command: class ListObjectsV2Command extends BaseCommand {},
    DeleteObjectsCommand: class DeleteObjectsCommand extends BaseCommand {},
    DeleteObjectCommand: class DeleteObjectCommand extends BaseCommand {},
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: awsMocks.presign,
}));

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

type S3Module = typeof import('@/lib/storage/s3');

/** Last command object handed to S3Client.send(). */
function lastCommand(): { name: string; input: CommandInput } {
  const call = awsMocks.send.mock.calls.at(-1);
  const command = call?.[0] as { constructor: { name: string }; input: CommandInput };
  return { name: command.constructor.name, input: command.input };
}

describe('lib/storage/s3', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const name of MANAGED_VARS) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    for (const name of MANAGED_VARS) {
      const value = saved[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const load = async (env: Record<string, string> = {}): Promise<S3Module> => {
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    vi.resetModules();
    return import('@/lib/storage/s3');
  };

  describe('bucket resolution at module load', () => {
    it('uses BACKUP_BUCKET when it is set', async () => {
      const s3 = await load({ S3_BUCKET: 'files', BACKUP_BUCKET: 'backups' });
      awsMocks.send.mockResolvedValue({});
      await s3.uploadBackup(Buffer.from('data'), 'db.sql');
      expect(lastCommand().input.Bucket).toBe('backups');
    });

    it('falls back to S3_BUCKET when BACKUP_BUCKET is unset', async () => {
      const s3 = await load({ S3_BUCKET: 'files' });
      awsMocks.send.mockResolvedValue({});
      await s3.uploadBackup(Buffer.from('data'), 'db.sql');
      expect(lastCommand().input.Bucket).toBe('files');
    });

    it('falls back to the hard-coded nucrm-backups bucket when nothing is configured', async () => {
      const s3 = await load();
      awsMocks.send.mockResolvedValue({});
      await s3.uploadBackup(Buffer.from('data'), 'db.sql');
      expect(lastCommand().input.Bucket).toBe('nucrm-backups');
    });
  });

  describe('uploadBackup', () => {
    it('writes under the backups/ prefix and returns the key', async () => {
      const s3 = await load({ S3_BUCKET: 'b' });
      awsMocks.send.mockResolvedValue({});

      const key = await s3.uploadBackup(Buffer.from('payload'), 'nucrm-2026-01-01.sql');
      expect(key).toBe('backups/nucrm-2026-01-01.sql');

      const { name, input } = lastCommand();
      expect(name).toBe('PutObjectCommand');
      expect(input.Key).toBe('backups/nucrm-2026-01-01.sql');
      expect(input.ContentType).toBe('application/sql');
      expect(input.Body).toEqual(Buffer.from('payload'));
      expect(input.Metadata).toMatchObject({ app: 'nucrm' });
    });

    it('propagates an upload failure instead of reporting success', async () => {
      const s3 = await load({ S3_BUCKET: 'b' });
      awsMocks.send.mockRejectedValue(new Error('AccessDenied'));
      await expect(s3.uploadBackup(Buffer.from('x'), 'f.sql')).rejects.toThrow('AccessDenied');
    });
  });

  describe('listBackups', () => {
    it('lists with the backups/ prefix and sorts newest first', async () => {
      const s3 = await load({ S3_BUCKET: 'b' });
      awsMocks.send.mockResolvedValue({
        Contents: [
          { Key: 'backups/old.sql', Size: 10, LastModified: new Date('2024-01-01') },
          { Key: 'backups/new.sql', Size: 20, LastModified: new Date('2026-01-01') },
          { Key: 'backups/mid.sql', Size: 15, LastModified: new Date('2025-01-01') },
        ],
      });

      const result = await s3.listBackups();
      expect(result.map(r => r.key)).toEqual([
        'backups/new.sql',
        'backups/mid.sql',
        'backups/old.sql',
      ]);
      expect(lastCommand().input.Prefix).toBe('backups/');
    });

    it('returns an empty array when the bucket has no contents', async () => {
      const s3 = await load({ S3_BUCKET: 'b' });
      awsMocks.send.mockResolvedValue({});
      expect(await s3.listBackups()).toEqual([]);
    });

    it('substitutes defaults for missing object fields', async () => {
      const s3 = await load({ S3_BUCKET: 'b' });
      awsMocks.send.mockResolvedValue({ Contents: [{}] });

      const [entry] = await s3.listBackups();
      expect(entry?.key).toBe('');
      expect(entry?.size).toBe(0);
      expect(entry?.lastModified).toBeInstanceOf(Date);
    });
  });

  describe('downloadBackup', () => {
    it('concatenates the response stream into a single buffer', async () => {
      const s3 = await load({ S3_BUCKET: 'b' });
      awsMocks.send.mockResolvedValue({
        Body: Readable.from([Buffer.from('hello '), Buffer.from('world')]),
      });

      const buf = await s3.downloadBackup('backups/x.sql');
      expect(buf.toString()).toBe('hello world');
      expect(lastCommand().name).toBe('GetObjectCommand');
      expect(lastCommand().input.Key).toBe('backups/x.sql');
    });

    it('returns an empty buffer for an empty object', async () => {
      const s3 = await load({ S3_BUCKET: 'b' });
      awsMocks.send.mockResolvedValue({ Body: Readable.from([]) });
      expect((await s3.downloadBackup('k')).length).toBe(0);
    });
  });

  describe('deleteOldBackups', () => {
    const listing = (count: number): { Contents: CommandInput[] } => ({
      Contents: Array.from({ length: count }, (_v, i) => ({
        Key: `backups/b${i}.sql`,
        Size: 1,
        LastModified: new Date(2026, 0, count - i),
      })),
    });

    it('does nothing when the retention count is not exceeded', async () => {
      const s3 = await load({ S3_BUCKET: 'b' });
      awsMocks.send.mockResolvedValue(listing(30));
      await s3.deleteOldBackups(30);
      expect(awsMocks.send).toHaveBeenCalledTimes(1); // list only
    });

    it('deletes only the backups beyond the retention count, oldest first', async () => {
      const s3 = await load({ S3_BUCKET: 'b' });
      awsMocks.send.mockResolvedValue(listing(5));

      await s3.deleteOldBackups(2);

      const { name, input } = lastCommand();
      expect(name).toBe('DeleteObjectsCommand');
      const del = input.Delete as { Objects: { Key: string }[] };
      expect(del.Objects.map(o => o.Key)).toEqual([
        'backups/b2.sql',
        'backups/b3.sql',
        'backups/b4.sql',
      ]);
    });

    it('defaults to keeping 30 backups', async () => {
      const s3 = await load({ S3_BUCKET: 'b' });
      awsMocks.send.mockResolvedValue(listing(31));
      await s3.deleteOldBackups();
      const del = lastCommand().input.Delete as { Objects: { Key: string }[] };
      expect(del.Objects).toHaveLength(1);
    });
  });

  describe('uploadFileToS3', () => {
    it('writes the key verbatim, without the backups/ prefix', async () => {
      const s3 = await load({ S3_BUCKET: 'b' });
      awsMocks.send.mockResolvedValue({});

      const key = await s3.uploadFileToS3(Buffer.from('x'), 'tenants/t1/logo.png', 'image/png');
      expect(key).toBe('tenants/t1/logo.png');
      expect(lastCommand().input).toMatchObject({
        Key: 'tenants/t1/logo.png',
        ContentType: 'image/png',
      });
    });

    it('defaults the content type to application/octet-stream', async () => {
      const s3 = await load({ S3_BUCKET: 'b' });
      awsMocks.send.mockResolvedValue({});
      await s3.uploadFileToS3(new Uint8Array([1, 2, 3]), 'k');
      expect(lastCommand().input.ContentType).toBe('application/octet-stream');
    });
  });

  describe('presigned URLs', () => {
    it('signs a GET URL with the default one-hour expiry', async () => {
      const s3 = await load({ S3_BUCKET: 'b' });
      awsMocks.presign.mockResolvedValue('https://signed/get');

      expect(await s3.getSignedUrl('backups/x.sql')).toBe('https://signed/get');
      const [, command, options] = awsMocks.presign.mock.calls.at(-1) ?? [];
      expect((command as { constructor: { name: string } }).constructor.name).toBe(
        'GetObjectCommand'
      );
      expect(options).toEqual({ expiresIn: 3600 });
    });

    it('honours an explicit GET expiry', async () => {
      const s3 = await load({ S3_BUCKET: 'b' });
      awsMocks.presign.mockResolvedValue('u');
      await s3.getSignedUrl('k', 60);
      expect(awsMocks.presign.mock.calls.at(-1)?.[2]).toEqual({ expiresIn: 60 });
    });

    it('locks the content type into a signed PUT URL and defaults to 10 minutes', async () => {
      const s3 = await load({ S3_BUCKET: 'b' });
      awsMocks.presign.mockResolvedValue('https://signed/put');

      const url = await s3.getSignedPutUrl({ key: 'up/1.png', contentType: 'image/png' });
      expect(url).toBe('https://signed/put');

      const [, command, options] = awsMocks.presign.mock.calls.at(-1) ?? [];
      const typed = command as { constructor: { name: string }; input: CommandInput };
      expect(typed.constructor.name).toBe('PutObjectCommand');
      expect(typed.input).toMatchObject({ Key: 'up/1.png', ContentType: 'image/png' });
      expect(typed.input.ContentLength).toBeUndefined();
      expect(options).toEqual({ expiresIn: 600 });
    });

    it('includes ContentLength only when a byte size is supplied', async () => {
      const s3 = await load({ S3_BUCKET: 'b' });
      awsMocks.presign.mockResolvedValue('u');

      await s3.getSignedPutUrl({
        key: 'k',
        contentType: 'text/plain',
        contentLengthBytes: 1234,
        expiresInSeconds: 30,
      });
      const [, command, options] = awsMocks.presign.mock.calls.at(-1) ?? [];
      expect((command as { input: CommandInput }).input.ContentLength).toBe(1234);
      expect(options).toEqual({ expiresIn: 30 });
    });

    it('omits ContentLength when the byte size is zero', async () => {
      const s3 = await load({ S3_BUCKET: 'b' });
      awsMocks.presign.mockResolvedValue('u');
      await s3.getSignedPutUrl({ key: 'k', contentType: 'text/plain', contentLengthBytes: 0 });
      const [, command] = awsMocks.presign.mock.calls.at(-1) ?? [];
      expect((command as { input: CommandInput }).input.ContentLength).toBeUndefined();
    });
  });

  describe('deleteObject', () => {
    it('issues a single-object delete for the given key', async () => {
      const s3 = await load({ S3_BUCKET: 'b', BACKUP_BUCKET: 'backups' });
      awsMocks.send.mockResolvedValue({});

      await s3.deleteObject('uploads/f.bin');
      const { name, input } = lastCommand();
      expect(name).toBe('DeleteObjectCommand');
      expect(input).toEqual({ Bucket: 'backups', Key: 'uploads/f.bin' });
    });
  });

  describe('client construction', () => {
    it('passes the resolved region, endpoint and credentials to the S3 client', async () => {
      const { S3Client } = await import('@aws-sdk/client-s3');
      await load({
        S3_BUCKET: 'b',
        S3_ACCESS_KEY: 'compose-access',
        S3_SECRET_KEY: 'compose-secret',
        S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
      });

      expect(S3Client).toHaveBeenCalledWith({
        region: 'auto',
        endpoint: 'https://acct.r2.cloudflarestorage.com',
        credentials: { accessKeyId: 'compose-access', secretAccessKey: 'compose-secret' },
      });
    });
  });
});
