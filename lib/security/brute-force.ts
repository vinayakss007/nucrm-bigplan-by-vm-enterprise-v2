/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Brute Force Protection Module
 * 
 * Features:
 * - Track failed login attempts by IP and email
 * - Auto-block after threshold (5 failures in 15 min = 30 min block)
 * - Clean up old records automatically
 */


import { sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { devLogger } from '@/lib/dev-logger';
import { withSecurityContext } from '@/lib/db/rls';

export interface BruteForceConfig {
  maxAttempts: number;      // Max failed attempts before block
  windowMinutes: number;    // Time window to count attempts
  blockMinutes: number;     // How long to block after exceeded
}

const DEFAULT_CONFIG: BruteForceConfig = {
  maxAttempts: 5,
  windowMinutes: 15,
  blockMinutes: 30,
};

/**
 * #1174: in-memory fail-safe used only when the persistent brute-force store is
 * unreachable. Fully failing open silently disables all protection during a DB
 * outage; fully failing closed locks out every user. Instead we degrade to a
 * short-lived per-identifier counter so a burst against a single identifier is
 * still throttled while legitimate traffic keeps flowing.
 */
const FALLBACK_MAX_ATTEMPTS = 10;
const FALLBACK_WINDOW_MS = 15 * 60 * 1000;
const fallbackAttempts = new Map<string, { count: number; firstAt: number }>();

function fallbackCheck(key: string): boolean {
  const now = Date.now();
  const entry = fallbackAttempts.get(key);
  if (!entry || now - entry.firstAt > FALLBACK_WINDOW_MS) {
    fallbackAttempts.set(key, { count: 1, firstAt: now });
    return false;
  }
  entry.count += 1;
  return entry.count > FALLBACK_MAX_ATTEMPTS;
}

/**
 * Check if an IP or email is blocked
 *
 * PP-012: `login_blocks` is covered by a FOR ALL policy gated on
 * app.is_super_admin (these rows are platform-wide security state, so there is
 * no tenant to scope them to). The store therefore runs in a security context.
 * The context is transaction-scoped (`SET LOCAL`) and this function touches
 * only these two security tables, so it cannot widen any request's reach.
 */
export async function isBlocked(
  identifier: string,
  type: 'ip' | 'email',
  _config: BruteForceConfig = DEFAULT_CONFIG
): Promise<{ blocked: boolean; blockedUntil?: Date; reason?: string }> {
  try {
    const now = new Date();

    return await withSecurityContext(async (tx) => {
      const blockResult = await tx.execute(sql`
        SELECT blocked_until, block_reason
        FROM login_blocks
        WHERE identifier = ${identifier}
          AND identifier_type = ${type}
          AND blocked_until > ${now}
        LIMIT 1
      `);
      const block = blockResult.rows?.[0];

      if (block && block['blocked_until']) {
        return {
          blocked: true,
          blockedUntil: new Date(block['blocked_until'] as string),
          reason: (block['block_reason'] as string) || 'Too many failed attempts',
        };
      }

      return { blocked: false };
    });
  } catch (err) {
    devLogger.error(err as Error, '[brute-force] isBlocked check failed');
    // #1174: the store is unreachable. Do NOT silently disable protection —
    // fall back to an in-memory per-identifier throttle so a burst is still
    // blocked, without hard-locking every user during a transient outage.
    logger.error('[brute-force] store unavailable — using in-memory fail-safe', {
      identifier,
      type,
    });
    const blocked = fallbackCheck(`${type}:${identifier}`);
    if (blocked) {
      return {
        blocked: true,
        blockedUntil: new Date(Date.now() + FALLBACK_WINDOW_MS),
        reason: 'Security check temporarily unavailable — rate limited',
      };
    }
    return { blocked: false };
  }
}

/**
 * Record a failed login attempt
 *
 * PP-012: see isBlocked. The insert, both window COUNTs and any resulting block
 * share one security-context transaction, which also closes the read-then-block
 * race that existed when every statement checked out its own pooled connection.
 */
export async function recordFailedAttempt(
  email: string,
  ipAddress: string,
  userAgent?: string,
  reason?: string
): Promise<void> {
  const config = DEFAULT_CONFIG;
  const windowStart = new Date(Date.now() - config.windowMinutes * 60 * 1000);

  try {
    await withSecurityContext(async (tx) => {
      await tx.execute(sql`
        INSERT INTO login_attempts (email, ip_address, user_agent, success, failure_reason, attempted_at)
        VALUES (${email}, ${ipAddress}, ${userAgent || null}, false, ${reason || null}, NOW())
      `);

      const ipResult = await tx.execute(sql`
        SELECT COUNT(*) as count
        FROM login_attempts
        WHERE ip_address = ${ipAddress}
          AND success = false
          AND attempted_at > ${windowStart}
      `);
      const ipCount = Number((ipResult.rows?.[0] as { count?: number })?.count || 0);

      const emailResult = await tx.execute(sql`
        SELECT COUNT(*) as count
        FROM login_attempts
        WHERE email = ${email.toLowerCase()}
          AND success = false
          AND attempted_at > ${windowStart}
      `);
      const emailCount = Number((emailResult.rows?.[0] as { count?: number })?.count || 0);

      if (ipCount >= config.maxAttempts) {
        await blockIdentifier(tx, ipAddress, 'ip', config.blockMinutes, `Too many failed login attempts (${ipCount}) from this IP`);
        logger.warn('IP blocked due to brute force', { ip: ipAddress, attempts: ipCount });
      }

      if (emailCount >= config.maxAttempts) {
        await blockIdentifier(tx, email.toLowerCase(), 'email', config.blockMinutes, `Too many failed login attempts (${emailCount}) for this email`);
        logger.warn('Email blocked due to brute force', { email, attempts: emailCount });
      }
    });
  } catch (err) {
    devLogger.error(err as Error, '[brute-force] recordFailedAttempt failed');
    // Don't let logging errors affect login
  }
}

/**
 * Record a successful login
 */
export async function recordSuccessfulLogin(
  email: string,
  ipAddress: string,
  userAgent?: string
): Promise<void> {
  try {
    await withSecurityContext(async (tx) => {
      await tx.execute(sql`
        INSERT INTO login_attempts (email, ip_address, user_agent, success, attempted_at)
        VALUES (${email.toLowerCase()}, ${ipAddress}, ${userAgent || null}, true, NOW())
      `);
    });
  } catch (err) {
    devLogger.error(err as Error, '[brute-force] recordSuccessfulLogin failed');
    // Don't let logging errors affect login
  }
}

/**
 * Block an identifier
 *
 * `client` is required: the caller owns the security context, and a block must
 * commit with the attempt count that triggered it rather than on a separate
 * connection where that context would not exist.
 */
async function blockIdentifier(
  client: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
  identifier: string,
  type: 'ip' | 'email',
  minutes: number,
  reason: string
): Promise<void> {
  const blockedUntil = new Date(Date.now() + minutes * 60 * 1000);

  await client.execute(sql`
    INSERT INTO login_blocks (identifier, identifier_type, blocked_until, block_reason, attempts_count, created_at)
    VALUES (${identifier}, ${type}, ${blockedUntil}, ${reason}, ${DEFAULT_CONFIG.maxAttempts}, NOW())
    ON CONFLICT (identifier, identifier_type)
    DO UPDATE SET
      blocked_until = ${blockedUntil},
      block_reason = ${reason},
      attempts_count = login_blocks.attempts_count + 1
  `);
}

/**
 * Get brute force status for an IP or email
 */
export async function getBruteForceStatus(
  identifier: string,
  type: 'ip' | 'email',
  config: BruteForceConfig = DEFAULT_CONFIG
): Promise<{
  attempts: number;
  blocked: boolean;
  blockedUntil?: Date;
  remainingAttempts: number;
}> {
  const windowStart = new Date(Date.now() - config.windowMinutes * 60 * 1000);

  try {
    // Two sequential security contexts, never nested, so one call never holds
    // two pooled connections at once.
    const attempts = await withSecurityContext(async (tx) => {
      const result = await tx.execute(sql`
        SELECT COUNT(*) as count
        FROM login_attempts
        WHERE ${type === 'ip' ? sql`ip_address` : sql`email`} = ${identifier}
          AND success = false
          AND attempted_at > ${windowStart}
      `);
      return Number((result.rows?.[0] as { count?: number })?.count || 0);
    });
    const checkBlock = await isBlocked(identifier, type, config);

    return {
      attempts,
      blocked: checkBlock.blocked,
      blockedUntil: checkBlock.blockedUntil,
      remainingAttempts: Math.max(0, config.maxAttempts - attempts),
    };
  } catch (err) {
    devLogger.error(err as Error, '[brute-force] getStatus failed');
    return {
      attempts: 0,
      blocked: false,
      remainingAttempts: config.maxAttempts,
    };
  }
}

/**
 * Clean up old blocks and attempts
 */
export async function cleanupOldRecords(): Promise<{ blocksCleaned: number; attemptsCleaned: number }> {
  try {
    return await withSecurityContext(async (tx) => {
      const blockResult = await tx.execute(sql`
        DELETE FROM login_blocks WHERE blocked_until < NOW()
      `);

      const attemptsResult = await tx.execute(sql`
        DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL '30 days'
      `);

      return {
        blocksCleaned: (blockResult as { rowCount?: number })?.rowCount || 0,
        attemptsCleaned: (attemptsResult as { rowCount?: number })?.rowCount || 0,
      };
    });
  } catch (err) {
    devLogger.error(err as Error, '[brute-force] cleanup failed');
    return { blocksCleaned: 0, attemptsCleaned: 0 };
  }
}
