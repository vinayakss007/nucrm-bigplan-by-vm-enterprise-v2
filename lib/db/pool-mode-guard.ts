/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Boot-time PgBouncer pool_mode assertion (#3506, Finding P0.1 residual).
 *
 * ADR-0003 and #3404 established session pooling (`pool_mode = session`) as a
 * strict system invariant for NuCRM. Under transaction or statement pooling,
 * session-level GUCs (such as `SET LOCAL app.current_tenant` or session GUCs used
 * for Row Level Security) do not persist across multiple statements on the same
 * connection handle or can silently leak between requests, bypassing tenant isolation.
 *
 * This module checks that whenever PgBouncer is in use (e.g. `PGBOUNCER_ENABLED=true`
 * or a connection string pointing to port 6432), the running pooler is confirmed to
 * be operating in `session` mode via `SHOW pool_mode;`. If not, it fails fast with a
 * loud descriptive error.
 */

import { redactConnectionString } from './least-privilege';
import { query } from './client';

/** Env flag that turns the pool_mode guard off — only the exact string `'false'`. */
export const POOL_MODE_GUARD_ENV = 'POOL_MODE_GUARD';

export class PoolModeInvariantError extends Error {
  readonly code = 'ERR_POOL_MODE_INVARIANT';

  constructor(message: string) {
    super(message);
    this.name = 'PoolModeInvariantError';
  }
}

export type PoolModeGuardStatus =
  | { state: 'disabled'; detail: string }
  | { state: 'skipped'; detail: string }
  | { state: 'ok'; poolMode: 'session' }
  | { state: 'violation'; message: string }
  | { state: 'error'; message: string };

let lastStatus: PoolModeGuardStatus | null = null;

export function getPoolModeGuardStatus(): PoolModeGuardStatus | null {
  return lastStatus;
}

export function resetPoolModeGuardStatus(): void {
  lastStatus = null;
}

/**
 * Returns true if PgBouncer is configured or used in the active environment.
 */
export function isPgBouncerInUse(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['PGBOUNCER_ENABLED'] === 'true' || /:6432\b/.test(env['DATABASE_URL'] || '');
}

/**
 * Execute SHOW pool_mode and assert that it returns 'session'.
 *
 * Throws PoolModeInvariantError if pool_mode is not 'session' or if the database
 * connection fails to recognize the pool_mode command while PgBouncer is flagged.
 */
export async function assertPoolMode(
  runQuery: <T extends Record<string, unknown>>(sql: string) => Promise<{ rows: T[] }>
): Promise<'session'> {
  let rows: Record<string, unknown>[];
  try {
    const res = await runQuery('SHOW pool_mode');
    rows = res.rows;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      /unrecognized configuration parameter.*pool_mode/i.test(msg) ||
      (err as { code?: string })?.code === '42704'
    ) {
      throw new PoolModeInvariantError(
        'PGBOUNCER_ENABLED=true is set, but the database connection does not recognize "SHOW pool_mode". ' +
        'The connection appears to target direct PostgreSQL (:5432) rather than PgBouncer. ' +
        'Direct connections must set PGBOUNCER_ENABLED=false (#3509).'
      );
    }
    throw new PoolModeInvariantError(`Failed to execute SHOW pool_mode: ${msg}`);
  }

  const row = rows[0];
  if (!row) {
    throw new PoolModeInvariantError('SHOW pool_mode returned an empty result');
  }

  const rawValue = row['pool_mode'] ?? row['value'] ?? Object.values(row)[0];
  if (typeof rawValue !== 'string') {
    throw new PoolModeInvariantError(`SHOW pool_mode returned unexpected shape: ${JSON.stringify(row)}`);
  }

  const mode = rawValue.trim().toLowerCase();
  if (mode !== 'session') {
    throw new PoolModeInvariantError(
      `PgBouncer pool_mode is "${rawValue.trim()}", but NuCRM requires "session" mode. ` +
      'Transaction or statement pooling causes session-scoped RLS tenant context (app.current_tenant) ' +
      'to leak or evaporate between queries (ADR-0003, #3404, #3506). Reconfigure PgBouncer with pool_mode = session.'
    );
  }

  return 'session';
}

export interface PoolModeGuardDeps {
  env?: NodeJS.ProcessEnv;
  runQuery?: <T extends Record<string, unknown>>(sql: string) => Promise<{ rows: T[] }>;
  notify?: (payload: { error: unknown; level: string; context: string }) => Promise<void>;
  log?: Pick<Console, 'log' | 'warn' | 'error'>;
}

async function defaultNotify(payload: {
  error: unknown;
  level: string;
  context: string;
}): Promise<void> {
  const { sendCriticalErrorAlert } = await import('../critical-error-alert');
  await sendCriticalErrorAlert(payload);
}

/**
 * Startup pool_mode guard (#3506).
 *
 * Verifies that the active PgBouncer pooler is running in session mode.
 * Records the outcome in getPoolModeGuardStatus() and alerts on violation.
 */
export async function guardPoolMode(deps: PoolModeGuardDeps = {}): Promise<PoolModeGuardStatus> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? console;
  const runQuery =
    deps.runQuery ?? (<T extends Record<string, unknown>>(sql: string) => query<T>(sql));
  const notify = deps.notify ?? defaultNotify;

  if (env[POOL_MODE_GUARD_ENV] === 'false') {
    lastStatus = { state: 'disabled', detail: `${POOL_MODE_GUARD_ENV}=false` };
    log.warn(
      `[pool-mode-guard] DISABLED by ${POOL_MODE_GUARD_ENV}=false — PgBouncer pool_mode is NOT verified (#3506).`
    );
    return lastStatus;
  }

  if (!isPgBouncerInUse(env)) {
    lastStatus = { state: 'skipped', detail: 'PgBouncer is not in use' };
    return lastStatus;
  }

  if (!env.DATABASE_URL) {
    lastStatus = { state: 'skipped', detail: 'DATABASE_URL not set' };
    return lastStatus;
  }

  if (env.NEXT_PHASE?.includes('build') || env.NODE_ENV === 'test') {
    lastStatus = { state: 'skipped', detail: 'build/test context' };
    return lastStatus;
  }

  try {
    const verifiedMode = await assertPoolMode(runQuery);
    lastStatus = { state: 'ok', poolMode: verifiedMode };
    log.log('[pool-mode-guard] OK — PgBouncer pool_mode is "session" (RLS GUC isolation verified).');
    return lastStatus;
  } catch (err) {
    const message = redactConnectionString(err instanceof Error ? err.message : String(err));

    if (err instanceof PoolModeInvariantError) {
      lastStatus = { state: 'violation', message };
      log.error('\n' + '='.repeat(72));
      log.error('[pool-mode-guard] FATAL INVARIANT VIOLATION (#3506):');
      log.error(`  ${message}`);
      log.error(
        '  The database connection is using an unsupported PgBouncer pool_mode or invalid pooler configuration.\n' +
        '  NuCRM requires session pooling (pool_mode = session) with server_reset_query = DISCARD ALL (ADR-0003).\n' +
        '  Serving requests under transaction pooling will cause cross-tenant data leaks.'
      );
      log.error('='.repeat(72) + '\n');
    } else {
      lastStatus = { state: 'error', message };
      log.error(`[pool-mode-guard] could not verify pool_mode: ${message}`);
    }

    await notify({
      error: new Error(message),
      level: lastStatus.state === 'violation' ? 'fatal' : 'error',
      context: 'db-pool-mode-guard',
    }).catch(() => {
      log.error('[pool-mode-guard] alert fan-out failed.');
    });

    return lastStatus;
  }
}
