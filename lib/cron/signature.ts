/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { createHmac } from 'node:crypto';

/**
 * The headers a caller of `/api/cron/*` owes, including the optional signature.
 *
 * `lib/auth/cron.ts` verifies `x-cron-signature` as an HMAC-SHA256 of the **raw
 * request body**, and it demands one as soon as `CRON_SIGNING_KEY` is set. Since #3298
 * every cron route checks that layer, so a scheduler that only sends `x-cron-secret`
 * is now locked out of all 22 endpoints — the operator who set a signing key would
 * have a silently dead cron, which is the same failure mode as the guard in #2539
 * finding a scheduler that never fired.
 *
 * The payload is `''` because no cron route reads a body: `deploy/cron/run-cron.sh`
 * posts `--post-data=""`, `scripts/fire-cron.mts` sends `content-length: 0`, and the
 * rest are query-string jobs. That is a contract, not an accident — if a route ever
 * starts reading a body, `tests/unit/cron-auth-uniform-3298.test.ts` is the file that
 * says so. `run-cron.sh` implements the same recipe in shell (`openssl dgst -hmac`);
 * the test pins the two digests equal, because a scheduler that signs differently from
 * the verifier fails closed with no useful error.
 */
export function cronAuthHeaders(opts: {
  secret: string;
  /** Defaults to `CRON_SIGNING_KEY`; pass `''` or null to skip signing. */
  signingKey?: string | null;
  body?: string;
}): Record<string, string> {
  const headers: Record<string, string> = { 'x-cron-secret': opts.secret };
  const key = opts.signingKey ?? process.env['CRON_SIGNING_KEY'] ?? '';
  if (key) {
    headers['x-cron-signature'] = 'sha256=' + createHmac('sha256', key).update(opts.body ?? '').digest('hex');
  }
  return headers;
}
