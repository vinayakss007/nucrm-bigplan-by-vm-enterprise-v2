/**
 * Unit tests for lib/restore/runtime-fs.ts — the filesystem/S3 shim the restore
 * pipeline uses to fetch a backup before replaying it. A silent failure here
 * means restoring from a truncated or absent file.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

type CommandInput = Record<string, unknown>;

const awsMocks = vi.hoisted(() => ({
  send: vi.fn(),
  clientCtor: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function MockS3Client(this: unknown, config: CommandInput) {
    awsMocks.clientCtor(config);
    return { send: awsMocks.send };
  }),
  GetObjectCommand: class GetObjectCommand {
    constructor(public readonly input: CommandInput) {}
  },
}));

import { checkFileExists, deleteFile, downloadFromS3 } from '@/lib/restore/runtime-fs';

describe('checkFileExists / deleteFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nucrm-runtime-fs-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports true for an existing file and false for a missing one', async () => {
    const p = join(dir, 'present.sql');
    writeFileSync(p, 'x');
    expect(await checkFileExists(p)).toBe(true);
    expect(await checkFileExists(join(dir, 'absent.sql'))).toBe(false);
  });

  it('deletes an existing file', async () => {
    const p = join(dir, 'doomed.sql');
    writeFileSync(p, 'x');
    await deleteFile(p);
    expect(existsSync(p)).toBe(false);
  });

  it('is a no-op (does not throw) when the file is already gone', async () => {
    await expect(deleteFile(join(dir, 'never-existed.sql'))).resolves.toBeUndefined();
  });
});

describe('downloadFromS3', () => {
  const backup = { id: 'abc123', storagePath: 'backups/tenant/abc123.dump' };
  const tempPath = join(tmpdir(), `restore_${backup.id}.dump`);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (existsSync(tempPath)) unlinkSync(tempPath);
  });

  it('writes the downloaded bytes to restore_<id>.dump in the OS temp dir and returns that path', async () => {
    const payload = Buffer.from('INSERT INTO contacts (id) VALUES (1);');
    awsMocks.send.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array(payload) },
    });

    const result = await downloadFromS3(backup, { bucket: 'nucrm-backups' });
    expect(result).toBe(tempPath);
    expect(readFileSync(tempPath).toString()).toBe(payload.toString());

    const command = awsMocks.send.mock.calls.at(-1)?.[0] as { input: CommandInput };
    expect(command.input).toEqual({
      Bucket: 'nucrm-backups',
      Key: 'backups/tenant/abc123.dump',
    });
  });

  it('defaults the region to us-east-1 and leaves the endpoint unset', async () => {
    awsMocks.send.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array([1]) },
    });
    await downloadFromS3(backup, { bucket: 'b' });
    expect(awsMocks.clientCtor).toHaveBeenCalledWith({
      region: 'us-east-1',
      endpoint: undefined,
    });
  });

  it('passes an explicit region and endpoint through to the client', async () => {
    awsMocks.send.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array([1]) },
    });
    await downloadFromS3(backup, {
      bucket: 'b',
      region: 'auto',
      endpoint: 'https://acct.r2.cloudflarestorage.com',
    });
    expect(awsMocks.clientCtor).toHaveBeenCalledWith({
      region: 'auto',
      endpoint: 'https://acct.r2.cloudflarestorage.com',
    });
  });

  it('throws instead of writing an empty file when the object has no body', async () => {
    awsMocks.send.mockResolvedValue({});
    await expect(downloadFromS3(backup, { bucket: 'b' })).rejects.toThrow(
      'Failed to download backup from S3'
    );
    expect(existsSync(tempPath)).toBe(false);
  });

  it('propagates an S3 error', async () => {
    awsMocks.send.mockRejectedValue(new Error('NoSuchKey'));
    await expect(downloadFromS3(backup, { bucket: 'b' })).rejects.toThrow('NoSuchKey');
  });
});
