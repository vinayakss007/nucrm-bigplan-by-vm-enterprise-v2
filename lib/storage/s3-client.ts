/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The one place an S3 client's transport options are decided (#3387).
 *
 * `forcePathStyle` defaults to false in the SDK, which builds a virtual-host
 * URL — `https://<bucket>.<endpoint-host>/<key>`. Against a self-hosted
 * gateway (`S3_ENDPOINT=http://minio:9000`) that is `http://nucrm-backups.minio:9000`,
 * a hostname nothing resolves, so the nightly dump, the retention purge and
 * backup verification all fail while the bucket itself is fine. Path-style
 * works on the gateway, on AWS and on R2; virtual-host works only on the two
 * clouds. Path-style is therefore the default and `S3_FORCE_PATH_STYLE=false`
 * is the operator's opt-out.
 */
import type { S3Client } from '@aws-sdk/client-s3';
import type { S3Credentials } from './s3-config';

/** Values an already-resolved configuration contributes to a client. */
export interface S3ClientSeed {
  region?: string;
  endpoint?: string;
  credentials?: S3Credentials;
  forcePathStyle?: boolean;
}

export interface S3ClientOptions {
  region: string;
  endpoint: string | undefined;
  credentials: S3Credentials | undefined;
  forcePathStyle: boolean;
}

const PATH_STYLE_OFF = ['false', '0', 'off', 'no'];

/** Path-style unless the operator names a value that turns it off. */
export function pathStyleFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env['S3_FORCE_PATH_STYLE'] ?? '').trim().toLowerCase();
  return !PATH_STYLE_OFF.includes(raw);
}

/**
 * Options for constructing an S3 client. A seed that carries no `forcePathStyle` —
 * an older configuration object, a caller that only knows region and endpoint
 * — still gets the repo's addressing policy rather than the SDK's default.
 */
export function s3ClientOptions(seed: S3ClientSeed = {}): S3ClientOptions {
  return {
    region: seed.region || 'us-east-1',
    endpoint: seed.endpoint,
    credentials: seed.credentials,
    forcePathStyle: seed.forcePathStyle ?? pathStyleFromEnv(),
  };
}

/** For callers that reach the SDK lazily, as the backup paths do. */
export async function createS3Client(seed: S3ClientSeed = {}): Promise<S3Client> {
  const { S3Client: ClientCtor } = await import('@aws-sdk/client-s3');
  return new ClientCtor(s3ClientOptions(seed));
}
