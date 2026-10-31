/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Provision and prove the S3 buckets (#3258).
 *
 * `lib/storage/s3.ts`, `lib/backups/offsite.ts` and `app/api/tenant/files/route.ts`
 * all used to write objects into a bucket nobody created, so the first upload on a
 * fresh endpoint answered `NoSuchBucket` — and on the provider this host actually
 * uses (#2054) the operator cannot even fix it by hand without knowing that
 * `CreateBucket` is refused by the IAM policy rather than by the software.
 *
 * This script asks the one question the app now asks too (does the bucket exist?
 * if not, can I make it?) and then goes further: it puts an object, reads it back,
 * compares the bytes, and deletes it. A bucket that exists and rejects your writes
 * is not a working bucket, and `HeadBucket` alone cannot tell the two apart.
 *
 * Usage:
 *   npm run storage:buckets                # both configured buckets
 *   npm run storage:buckets -- --json      # machine-readable
 *   npm run storage:buckets -- --bucket documents-bucket   # add one explicitly
 *   npm run storage:buckets -- --keep-probe               # leave the probe object
 *
 * It never prints a credential: only the env var NAMES that supplied them.
 */

import type { S3Client } from '@aws-sdk/client-s3';
import { getS3Config, describeS3ConfigGap, type S3Config } from '../lib/storage/s3-config';
import { createS3Client } from '../lib/storage/s3-client';
import { ensureBucket, type BucketAssurance } from '../lib/storage/ensure-bucket';

export interface BucketReport {
  bucket: string;
  assurance: BucketAssurance['status'];
  detail?: string;
  roundTrip: 'ok' | 'failed';
  error?: string;
}

/** The buckets this deployment is configured to use, deduped, config order kept. */
export function configuredBuckets(cfg: S3Config, extra: string[] = []): string[] {
  const names = [cfg.bucket, cfg.backupBucket, ...extra].filter((b): b is string => Boolean(b && b.trim()));
  return [...new Set(names.map((b) => b.trim()))];
}

export const PROBE_PREFIX = 'nucrm-provision-check/';

/**
 * Put → get → compare → delete. The object name is unique per run so a failed
 * cleanup never shadows a later verdict, and the delete is the only destructive
 * thing here — of an object this function created, one run ago, at this path.
 */
export async function roundTrip(bucket: string, client: S3Client, keepProbe = false): Promise<{ ok: true } | { ok: false; error: string }> {
  const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  const { randomBytes } = await import('node:crypto');
  const key = `${PROBE_PREFIX}${new Date().toISOString()}-${randomBytes(4).toString('hex')}.txt`;
  const body = Buffer.from(`nucrm provision check ${key}`);
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'text/plain' }));
    const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await (got.Body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    if (Buffer.compare(body, Buffer.from(bytes)) !== 0) {
      return { ok: false, error: 'read-back bytes differ from the bytes written' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  } finally {
    if (!keepProbe) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch {
        // A probe object left behind is noise in a bucket, not a wrong answer;
        // the verdict this run printed was decided by the bytes it read back.
      }
    }
  }
}

export async function checkOne(bucket: string, cfg: S3Config, client: S3Client, keepProbe = false): Promise<BucketReport> {
  const report: BucketReport = { bucket, assurance: 'unverifiable', roundTrip: 'failed' };
  let assurance: BucketAssurance;
  try {
    assurance = await ensureBucket(bucket, cfg, client);
  } catch (err) {
    return { ...report, error: (err as Error)?.message ?? String(err) };
  }
  report.assurance = assurance.status;
  if (assurance.status === 'unverifiable') report.detail = assurance.detail;

  const trip = await roundTrip(bucket, client, keepProbe);
  if (trip.ok) {
    report.roundTrip = 'ok';
    return report;
  }
  report.error = trip.error;
  return report;
}

export async function main(argv: string[] = process.argv.slice(2), clientFactory?: (cfg: S3Config) => S3Client): Promise<number> {
  const json = argv.includes('--json');
  const keepProbe = argv.includes('--keep-probe');
  const extra: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--bucket' && argv[i + 1]) extra.push(argv[++i]);
  }

  const cfg = getS3Config();
  const gap = describeS3ConfigGap();
  if (gap && extra.length === 0) {
    const message = `${gap} — nothing to provision. Point S3_BUCKET (and optionally BACKUP_BUCKET) at the endpoint you want checked.`;
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
    else process.stderr.write(`[provision-s3-buckets] FAIL — ${message}\n`);
    return 1;
  }

  const client = clientFactory ? clientFactory(cfg) : await createS3Client(cfg);

  const buckets = configuredBuckets(cfg, extra);
  const reports: BucketReport[] = [];
  for (const bucket of buckets) reports.push(await checkOne(bucket, cfg, client, keepProbe));

  const failed = reports.filter((r) => r.roundTrip === 'failed');
  const ok = failed.length === 0;

  if (json) {
    process.stdout.write(`${JSON.stringify({
      ok,
      endpoint: cfg.endpoint ?? `aws:${cfg.region}`,
      region: cfg.region,
      // Names only — the values are credentials (#3281 keeps literals out of every artifact).
      credentialsFrom: cfg.resolvedFrom,
      reports,
    }, null, 2)}\n`);
  } else {
    for (const r of reports) {
      const assuredWord = r.assurance === 'present' ? 'exists' : r.assurance === 'created' ? 'created it' : `not confirmable (${r.detail})`;
      process.stdout.write(`[provision-s3-buckets] ${r.bucket}: ${assuredWord}; write round trip ${r.roundTrip === 'ok' ? 'OK' : `FAILED — ${r.error}`}\n`);
    }
  }
  if (!ok) {
    if (!json) process.stderr.write('[provision-s3-buckets] FAIL — a bucket could not be made writable.\n');
    return 1;
  }
  if (!json) process.stdout.write(`[provision-s3-buckets] OK — ${reports.length} bucket(s) writable at ${cfg.endpoint ?? `aws:${cfg.region}`}.\n`);
  return 0;
}

if (process.argv[1]?.includes('provision-s3-buckets')) {
  main().then((code) => { process.exitCode = code; });
}
