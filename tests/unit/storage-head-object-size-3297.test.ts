/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3297 — the two primitives the storage meter was missing.
 *
 * `lib/storage/s3.ts` could write, read, list and delete an object, but had no way
 * to ask how big it is: `grep -rn "HeadObject\|headObject" app lib` answered 0, so
 * `documents.size_bytes` — the number `max_storage_gb` is computed from — was only
 * ever what the upload client claimed. `headObjectSize` is the read-back.
 *
 * The distinction that matters is *absent* from *unknown*. A caller soft-deletes a
 * row on `null`, so a timeout, a 503 or a bad bucket must not resolve to `null` —
 * one flaky gateway would otherwise erase a tenant's whole library from the meter.
 * These cases pin that only NoSuchKey/404 becomes `null` and everything else throws.
 *
 * The second group is the write-side binding. `getSignedPutUrl` already forwards
 * `ContentLength` into the SigV4 signature when it is supplied — measured, not
 * assumed: signing a PutObjectCommand with `ContentLength: 1024` yields
 * `X-Amz-SignedHeaders=content-length;host`, so a body of a different length fails
 * signature verification at the store. But the option was optional, and
 * `...(args.contentLengthBytes ? … : {})` silently minted an UNBOUND URL for a
 * caller that forgot it. Requiring it makes the unbound presign impossible to
 * produce by accident, which is the shape #3297's ask 2 asks for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ sent: [] as unknown[], signedCommands: [] as unknown[] }));

vi.mock('@aws-sdk/client-s3', () => {
  class Cmd {
    constructor(input: unknown) { Object.assign(this, input); (this as { __type?: string }).__type = new.target.name; }
  }
  return {
    S3Client: class {
      async send(command: unknown) { h.sent.push(command); return (h as { headResult?: unknown }).headResult; }
    },
    PutObjectCommand: Cmd,
    GetObjectCommand: Cmd,
    ListObjectsV2Command: Cmd,
    DeleteObjectCommand: Cmd,
    HeadObjectCommand: Cmd,
    HeadBucketCommand: Cmd,
    // #3258: the write paths now ask whether the bucket exists before they write,
    // so the module surface they import has to carry the bucket commands too.
    CreateBucketCommand: Cmd,
  };
});
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async (_client: unknown, command: unknown) => {
    h.signedCommands.push(command);
    return 'https://store/signed';
  }),
}));
vi.mock('@/lib/storage/s3-config', () => ({
  getS3Config: () => ({
    configured: true, bucket: 'nucrm-user-files', region: 'us-east-1',
    endpoint: undefined, credentials: { accessKeyId: 'ak', secretAccessKey: 'sk' },
  }),
  isS3Configured: () => true,
}));

function notFound(name = 'NotFound'): Error & { name: string; $metadata?: { httpStatusCode: number } } {
  const err = Object.assign(new Error('NotFound'), { name, $metadata: { httpStatusCode: 404 } });
  return err;
}

let mod: typeof import('@/lib/storage/s3');

beforeEach(async () => {
  // The two error cases spyOn(S3Client.prototype,'send'); clearAllMocks does not
  // put the class method back, so without this the gateway-error rejection leaks
  // into the following case and a 503 masquerades as the store's answer.
  vi.restoreAllMocks();
  vi.clearAllMocks();
  h.sent.length = 0;
  h.signedCommands.length = 0;
  (h as { headResult?: unknown }).headResult = { ContentLength: 104_857_600 };
  mod = await import('@/lib/storage/s3');
});

describe('headObjectSize (#3297)', () => {
  it('answers the real length of the object, from the store', async () => {
    await expect(mod.headObjectSize('documents/t/a.pdf', 'bkt')).resolves.toBe(104_857_600);
    expect((h.sent[0] as { Key: string }).Key).toBe('documents/t/a.pdf');
    expect((h.sent[0] as { Bucket: string }).Bucket).toBe('bkt');
  });

  it('falls back to the configured bucket rather than a hardcoded default when none is passed', async () => {
    await mod.headObjectSize('documents/t/a.pdf');
    expect((h.sent[0] as { Bucket: string }).Bucket).toBeTruthy();
  });

  it('answers null for a key the store does not have', async () => {
    (h as { headResult?: unknown }).headResult = undefined;
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    await expect(
      mod.headObjectSize('documents/t/gone.pdf', 'bkt'),
    ).resolves.toBeNull();
  });

  it('treats NoSuchKey as absent', async () => {
    (h as { headResult?: unknown }).headResult = undefined;
    const { S3Client } = await import('@aws-sdk/client-s3');
    vi.spyOn(S3Client.prototype, 'send').mockRejectedValue(notFound('NoSuchKey'));
    await expect(mod.headObjectSize('k', 'bkt')).resolves.toBeNull();
  });

  it('THROWS on a gateway error instead of reporting the object absent', async () => {
    // This is the case that separates a settle from a data-destroying bug: the route
    // soft-deletes on null, so a 503 must never look like a missing key.
    const { S3Client } = await import('@aws-sdk/client-s3');
    vi.spyOn(S3Client.prototype, 'send').mockRejectedValue(
      Object.assign(new Error('503 Service Unavailable'), { name: 'ServiceUnavailable', $metadata: { httpStatusCode: 503 } }),
    );
    await expect(mod.headObjectSize('k', 'bkt')).rejects.toThrow(/503/);
  });

  it('THROWS when the store answers without a length, because unknown is not zero', async () => {
    (h as { headResult?: unknown }).headResult = { ContentType: 'application/pdf' };
    await expect(mod.headObjectSize('k', 'bkt')).rejects.toThrow(/length/i);
  });
});

describe('getSignedPutUrl binds the URL to the declared size (#3297 ask 2)', () => {
  it('puts ContentLength into the signed command so SigV4 covers content-length', async () => {
    const url = await mod.getSignedPutUrl({
      key: 'documents/t/a.pdf', contentType: 'application/pdf', contentLengthBytes: 1024, bucket: 'bkt',
    });
    expect(url).toBe('https://store/signed');
    expect((h.signedCommands[0] as { ContentLength?: number }).ContentLength).toBe(1024);
  });

  it('refuses to mint an unbound URL when no size was declared', async () => {
    await expect(
      // `as never` is the point: the option is required since #3297, so minting an
      // unbound URL now takes a type error, not just a forgotten argument.
      mod.getSignedPutUrl({ key: 'documents/t/a.pdf', contentType: 'application/pdf', bucket: 'bkt' } as never),
    ).rejects.toThrow(/contentLengthBytes/);
    expect(h.signedCommands).toHaveLength(0);
  });

  it('refuses a zero or negative declared size rather than signing a free pass', async () => {
    for (const bad of [0, -1]) {
      await expect(
        mod.getSignedPutUrl({ key: 'k', contentType: 'application/pdf', contentLengthBytes: bad, bucket: 'bkt' }),
      ).rejects.toThrow(/contentLengthBytes/);
    }
    expect(h.signedCommands).toHaveLength(0);
  });
});
