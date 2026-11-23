/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Real-S3 storage integration (#2537 verification).
 *
 * Every other S3-related test in this repo mocks `@aws-sdk/client-s3`, so the
 * presigner's `ContentLength` binding, the store's actual 404-vs-503 error
 * shapes and bucket addressing were only ever believed. This suite drives the
 * real storage layer against whatever S3-compatible endpoint the environment
 * names. It SKIPS entirely when S3 is not configured, so it is safe in CI.
 *
 * All keys are random and deleted in afterAll — no tenant or app data is read
 * or written. Set S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY /
 * S3_BUCKET to run it; BACKUP_BUCKET is optional (falls back to S3_BUCKET).
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

import { getS3Config, isS3Configured } from '@/lib/storage/s3-config';
import { s3ClientOptions } from '@/lib/storage/s3-client';
import { ensureBucket } from '@/lib/storage/ensure-bucket';
import {
  deleteObject,
  downloadBackup,
  getSignedPutUrl,
  getSignedUrl,
  headObjectSize,
  listBackups,
  uploadBackup,
  uploadFileToS3,
} from '@/lib/storage/s3';

const configured = isS3Configured();
const cfg = getS3Config();
const bucket = cfg.bucket ?? '';
const runId = randomUUID();
const prefix = `integration/s3-storage-live/${runId}/`;
const createdKeys: string[] = [];

const FETCH_TIMEOUT_MS = 20_000;

describe.skipIf(!configured)('real S3 storage layer', () => {
  afterAll(async () => {
    for (const key of [...createdKeys].reverse()) {
      await deleteObject(key, bucket).catch(() => {});
    }
  });

  it('probes the configured bucket through the store', async () => {
    const client = new S3Client(s3ClientOptions(cfg));
    try {
      const assurance = await ensureBucket(bucket, cfg, client);
      expect(['present', 'created']).toContain(assurance.status);
    } finally {
      client.destroy();
    }
  });

  it('uploads tenant-prefixed objects and reads them by signed URL', async () => {
    const tenantA = `${prefix}tenant-a/`;
    const tenantB = `${prefix}tenant-b/`;
    const aBody = Buffer.from('tenant A bytes');
    const bBody = Buffer.from('tenant B bytes');
    const aKey = `${tenantA}${randomUUID()}.txt`;
    const bKey = `${tenantB}${randomUUID()}.txt`;
    createdKeys.push(aKey, bKey);

    await uploadFileToS3(aBody, aKey, 'text/plain', bucket);
    await uploadFileToS3(bBody, bKey, 'text/plain', bucket);
    expect(await headObjectSize(aKey, bucket)).toBe(aBody.length);
    expect(await headObjectSize(bKey, bucket)).toBe(bBody.length);

    const client = new S3Client(s3ClientOptions(cfg));
    try {
      const listA = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: tenantA }));
      const listB = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: tenantB }));
      expect((listA.Contents ?? []).map((o) => o.Key)).toEqual([aKey]);
      expect((listB.Contents ?? []).map((o) => o.Key)).toEqual([bKey]);
    } finally {
      client.destroy();
    }

    for (const [key, body] of [[aKey, aBody], [bKey, bBody]] as const) {
      const url = await getSignedUrl(key, 60, bucket);
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(body.toString());
    }
  });

  it('binds Content-Length into a presigned PUT and rejects a different length', async () => {
    const body = Buffer.from('exact length payload');
    const key = `${prefix}presigned-${randomUUID()}.txt`;
    createdKeys.push(key);
    const url = await getSignedPutUrl({
      key,
      contentType: 'text/plain',
      contentLengthBytes: body.length,
      expiresInSeconds: 60,
      bucket,
    });
    const put = await fetch(url, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'text/plain' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    expect(put.ok).toBe(true);
    expect(await headObjectSize(key, bucket)).toBe(body.length);

    const wrongKey = `${prefix}presigned-wrong-${randomUUID()}.txt`;
    const wrongUrl = await getSignedPutUrl({
      key: wrongKey,
      contentType: 'text/plain',
      contentLengthBytes: 5,
      expiresInSeconds: 60,
      bucket,
    });
    const wrong = await fetch(wrongUrl, {
      method: 'PUT',
      body: Buffer.from('much longer than five bytes'),
      headers: { 'Content-Type': 'text/plain' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    expect(wrong.ok).toBe(false);
  });

  it('reports a missing key as null, not an outage', async () => {
    expect(await headObjectSize(`${prefix}missing-${randomUUID()}.txt`, bucket)).toBeNull();
  });

  it('round-trips the backup facade through the same bucket', async () => {
    const body = Buffer.from(`backup facade round trip ${runId}`);
    const name = `s3-storage-live-${runId}.dump`;
    const key = await uploadBackup(body, name);
    createdKeys.push(key);
    expect(key).toBe(`backups/${name}`);
    expect((await listBackups()).some((entry) => entry.key === key)).toBe(true);
    expect((await downloadBackup(key)).equals(body)).toBe(true);
  });
});
