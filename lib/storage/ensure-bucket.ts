/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Bucket assurance (#3258).
 *
 * Every object write in this repo assumed its bucket existed. Nothing created one:
 * `grep -rn "CreateBucket" .` over the tree at `a32e14be0` answered **0**, and the
 * only `HeadBucket` was `app/api/superadmin/health/route.ts:51-54`, which reports a
 * missing bucket and stops there. So a first upload against a fresh MinIO /
 * SeaweedFS / R2 endpoint failed as a bare `NoSuchBucket`, and on the presigned-PUT
 * path the *browser* was the one that found out — with no NuCRM error behind it.
 *
 * The contract is three-valued because providers disagree about who may answer the
 * question:
 *
 * - `present` / `created` — the store said yes, or said no and we fixed it;
 * - `unverifiable` — the probe was refused or unreachable, which is NOT evidence of
 *   absence. A role that can `PutObject` but not `HeadBucket` is a normal
 *   deployment, and the live managed provider (#2054) refuses `CreateBucket`
 *   outright, so treating a refusal as "create it" would turn working uploads into
 *   errors.
 *
 * Only a positively-absent bucket whose create was denied throws. Everything else
 * lets the write go ahead and lets the write itself be the authority.
 */

import type { S3Client, BucketLocationConstraint } from '@aws-sdk/client-s3';
import type { S3Config } from './s3-config';

export type BucketAssurance =
  | { status: 'present' }
  | { status: 'created' }
  | { status: 'unverifiable'; detail: string };

/** Raised when the store says the bucket is absent and this role may not make it. */
export class BucketProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BucketProvisioningError';
  }
}

function reason(err: unknown): { code: string; status?: number } {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } } | null;
  return { code: e?.Code || e?.name || '', status: e?.$metadata?.httpStatusCode };
}

/** The answers that mean "this key space has no bucket by that name". */
function isAbsentResponse(err: unknown): boolean {
  const { code, status } = reason(err);
  return status === 404 || code === 'NoSuchBucket' || code === 'NotFound';
}

/** Someone (a retry, another process) created it between our HEAD and our PUT. */
function isRacilyExisting(err: unknown): boolean {
  const { code, status } = reason(err);
  return status === 409 || code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists';
}

function isRefused(err: unknown): boolean {
  const { code, status } = reason(err);
  return status === 403 || code === 'AccessDenied' || code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch';
}

/**
 * AWS rejects a `LocationConstraint` for `us-east-1`, Cloudflare R2 requires the
 * literal `auto` and takes no configuration block, and the self-hosted gateways
 * ignore it. Sending it only where it is both meaningful and accepted is the only
 * version of this that works on all four.
 */
function locationConstraint(region: string | undefined): { LocationConstraint: BucketLocationConstraint } | undefined {
  if (!region || region === 'us-east-1' || region === 'auto') return undefined;
  return { LocationConstraint: region as BucketLocationConstraint };
}

async function ask(bucket: string, cfg: S3Config, client: S3Client): Promise<BucketAssurance> {
  const { HeadBucketCommand, CreateBucketCommand } = await import('@aws-sdk/client-s3');
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return { status: 'present' };
  } catch (err) {
    if (!isAbsentResponse(err)) {
      const { code, status } = reason(err);
      return {
        status: 'unverifiable',
        detail: `HEAD ${bucket} answered ${code || `HTTP ${String(status)}`} — a refusal is not evidence of absence`,
      };
    }
  }

  const placement = locationConstraint(cfg.region);
  try {
    await client.send(
      new CreateBucketCommand({ Bucket: bucket, ...(placement ? { CreateBucketConfiguration: placement } : {}) })
    );
    return { status: 'created' };
  } catch (err) {
    if (isRacilyExisting(err)) return { status: 'present' };
    if (isRefused(err)) {
      throw new BucketProvisioningError(
        `bucket "${bucket}" does not exist at ${cfg.endpoint ?? `aws:${cfg.region}`} and this role may not create it ` +
          `(${reason(err).code || 'AccessDenied'}). Create it out of band — \`npm run storage:buckets\` ` +
          `(scripts/provision-s3-buckets.mts) provisions both configured buckets and proves the credentials with a ` +
          'put/get/delete round trip — or grant s3:CreateBucket. A managed provider that refuses the grant (#2054) ' +
          'has to be done in its console.'
      );
    }
    throw err;
  }
}

/**
 * Successes live for the life of the process — one probe per bucket, not one per
 * upload. A refusal or an outage is NOT cached: the next write asks again, so a
 * bucket created while this process was running is seen without a restart.
 */
const assured = new Map<string, Promise<BucketAssurance>>();

export function ensureBucket(bucket: string, cfg: S3Config, client: S3Client): Promise<BucketAssurance> {
  if (!bucket) return Promise.resolve({ status: 'unverifiable', detail: 'no bucket was named by the caller' });
  if (!cfg.configured) {
    const missing = [
      cfg.bucket ? null : 'S3_BUCKET',
      cfg.resolvedFrom.accessKeyId ? null : 'an S3 access key',
      cfg.resolvedFrom.secretAccessKey ? null : 'an S3 secret key',
    ].filter(Boolean).join(', ');
    return Promise.resolve({ status: 'unverifiable', detail: `S3 is not configured (missing ${missing}); not probing the store` });
  }

  const key = `${cfg.endpoint ?? `aws:${cfg.region}`}|${bucket}`;
  const running = assured.get(key);
  if (running) return running;

  const probe = ask(bucket, cfg, client).then(
    (answer) => {
      if (answer.status === 'unverifiable') assured.delete(key);
      return answer;
    },
    (err) => {
      assured.delete(key);
      throw err;
    }
  );
  assured.set(key, probe);
  return probe;
}

/** Test seam: the memo is process state, and a suite that fakes the store must be able to reset it. */
export function resetBucketAssurance(): void {
  assured.clear();
}
