/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest } from 'next/server';
import { createHmac } from 'crypto';
import { verifySecret } from '@/lib/crypto';

/**
 * Cron endpoint authentication (#1165).
 *
 * The baseline check is a timing-safe comparison of the `x-cron-secret` header
 * against `CRON_SECRET`. That alone means a single leaked secret grants access
 * to every cron endpoint with no accountability, so this module adds three
 * OPT-IN, defence-in-depth layers on top — each enabled only when its env var
 * is configured, so existing deployments and callers keep working unchanged:
 *
 *   1. IP allowlisting   — `CRON_ALLOWED_IPS` (comma-separated IPs / CIDRs).
 *   2. HMAC request signing — `CRON_SIGNING_KEY`; caller sends
 *      `x-cron-signature: sha256=<hex>` over the raw request body.
 *   3. Audit logging     — every allow/deny decision is recorded (fire-and-
 *      forget) so there is a trail of which job authenticated and why one was
 *      rejected.
 *
 * Fails CLOSED: any misconfiguration or unexpected error denies the request.
 */

interface CronAuthResult {
  ok: boolean;
  /** Machine-readable reason, useful for the audit trail. */
  reason:
    | 'ok'
    | 'secret_not_configured'
    | 'secret_missing'
    | 'secret_mismatch'
    | 'ip_not_allowed'
    | 'signature_missing'
    | 'signature_mismatch'
    | 'error';
}

/** Parse a comma/space separated allowlist env var into trimmed entries. */
function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function ipv4ToLong(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let long = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    long = (long << 8) + n;
  }
  return long >>> 0;
}

/** IPv4 CIDR / exact match. Non-IPv4 or malformed entries never match. */
function ipMatches(clientIp: string, entry: string): boolean {
  if (!entry.includes('/')) return entry === clientIp;

  const [subnet, maskRaw] = entry.split('/');
  const maskBits = Number(maskRaw);
  if (!Number.isInteger(maskBits) || maskBits < 0 || maskBits > 32) return false;

  const ipLong = ipv4ToLong(clientIp);
  const subnetLong = ipv4ToLong(subnet ?? '');
  if (ipLong === null || subnetLong === null) return false;

  // maskBits === 0 must match everything; the shift below is undefined for 32.
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ipLong & mask) === (subnetLong & mask);
}

function isIpAllowed(clientIp: string, allowlist: string[]): boolean {
  return allowlist.some((entry) => ipMatches(clientIp, entry));
}

/**
 * Extract the caller IP. Header values are client-spoofable unless the
 * deployment sits behind a trusted proxy, so they are only honoured when
 * TRUST_PROXY=true (consistent with lib/client-ip). Returns null when the IP
 * cannot be trusted, which — with an allowlist configured — fails closed.
 */
function getTrustedIp(req: NextRequest): string | null {
  if (process.env.TRUST_PROXY !== 'true') return null;
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || req.headers.get('x-real-ip') || null;
}

/**
 * Full cron auth check returning a structured result. Applies the static
 * secret plus any configured opt-in controls. Does NOT write the audit log —
 * callers that want the trail should use {@link verifyCronRequest}.
 */
export async function checkCronAuth(req: NextRequest, rawBody?: string): Promise<CronAuthResult> {
  try {
    const expected = process.env.CRON_SECRET;
    if (!expected) return { ok: false, reason: 'secret_not_configured' };

    const provided = req.headers.get('x-cron-secret');
    if (!provided) return { ok: false, reason: 'secret_missing' };
    if (!verifySecret(provided, expected)) return { ok: false, reason: 'secret_mismatch' };

    // Layer 1: IP allowlist (only enforced when configured).
    const allowlist = parseAllowlist(process.env.CRON_ALLOWED_IPS);
    if (allowlist.length > 0) {
      const ip = getTrustedIp(req);
      if (!ip || !isIpAllowed(ip, allowlist)) {
        return { ok: false, reason: 'ip_not_allowed' };
      }
    }

    // Layer 2: HMAC body signature (only enforced when a signing key is set).
    const signingKey = process.env.CRON_SIGNING_KEY;
    if (signingKey) {
      const header = req.headers.get('x-cron-signature');
      if (!header) return { ok: false, reason: 'signature_missing' };
      const providedSig = header.startsWith('sha256=') ? header.slice(7) : header;
      const expectedSig = createHmac('sha256', signingKey)
        .update(rawBody ?? '')
        .digest('hex');
      if (!verifySecret(providedSig, expectedSig)) {
        return { ok: false, reason: 'signature_mismatch' };
      }
    }

    return { ok: true, reason: 'ok' };
  } catch {
    // Fail closed on any unexpected error.
    return { ok: false, reason: 'error' };
  }
}

/**
 * Write a cron auth decision to the structured error/audit log. Fire-and-
 * forget and fully guarded so it can never turn an auth check into a 500 or
 * block the request path (e.g. in test environments without a DB).
 */
function auditCronAuth(jobName: string, result: CronAuthResult, ip: string | null): void {
  // Successful auth on the happy path is high-volume and low-signal; only the
  // denials (and misconfiguration) are worth a persisted record.
  if (result.ok) return;
  void (async () => {
    try {
      const { logError } = await import('@/lib/errors-server');
      await logError({
        error: new Error(`Cron auth denied for "${jobName}": ${result.reason}`),
        context: 'cron-auth',
        level: 'warning',
        metadata: { job: jobName, reason: result.reason, ip: ip ?? 'unknown' },
      });
    } catch {
      /* never let auditing break auth */
    }
  })();
}

/**
 * Backwards-compatible boolean check used by existing cron routes.
 *
 * Verifies the timing-safe secret plus any configured opt-in controls (IP
 * allowlist / HMAC signature) and records denied attempts to the audit log.
 * The signature is unchanged, so no route needs to be modified to benefit.
 */
export async function verifyCronSecret(req: NextRequest, opts?: { job?: string; rawBody?: string }): Promise<boolean> {
  const result = await checkCronAuth(req, opts?.rawBody);
  auditCronAuth(opts?.job ?? 'unknown', result, getTrustedIp(req));
  return result.ok;
}
