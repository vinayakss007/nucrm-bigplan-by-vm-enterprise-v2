/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Startup connection-role guard (#2306).
 *
 * `scripts/preflight.ts`, `scripts/verify-tenant-isolation.ts` and
 * `scripts/check-db-role-privileges.mjs` all assert the same invariant: the role
 * the application connects as must NOT be a cluster superuser or BYPASSRLS,
 * because either attribute silently turns every `tenant_isolation` policy into a
 * no-op. Before #2306 nothing scheduled those scripts, so the invariant was a
 * runtime fact someone might check — not an enforced one. One edited
 * `DATABASE_URL` (a restore pointed at the dev `postgres` superuser, say)
 * disabled tenant isolation for every paying customer while every test stayed
 * green.
 *
 * This module closes the third leg: the running process checks the invariant
 * itself, at boot, and says so loudly — without killing a live app.
 *
 * Contract:
 *   - Default ON. Disabled only with the explicit `RLS_ROLE_GUARD=false` env
 *     flag (mirrors how `DATABASE_SSL` is read in `lib/db/ssl-config.ts`).
 *   - Never exits the process and never throws at the caller: a violation is
 *     logged via `console.error`, pushed to the existing critical-alert fan-out
 *     (Telegram / PagerDuty / webhook — `lib/critical-error-alert.ts`), and
 *     surfaced through `getRoleGuardStatus()` for the health/metrics path.
 *   - Never logs the connection string. Messages are run through
 *     `redactConnectionString()` because a `pg` driver error can echo the URL.
 */

import {
  assertRoleIsRlsConstrained,
  redactConnectionString,
  RlsRoleBypassError,
  type RolePrivilegeVerdict,
} from './least-privilege';
import { query } from './client';

/** Env flag that turns the startup guard off — only the exact string `'false'`. */
export const RLS_ROLE_GUARD_ENV = 'RLS_ROLE_GUARD';

export type RoleGuardStatus =
  | { state: 'disabled'; detail: string }
  | { state: 'skipped'; detail: string }
  | { state: 'ok'; rolname: string }
  | { state: 'violation'; message: string }
  | { state: 'error'; message: string };

let lastStatus: RoleGuardStatus | null = null;

/**
 * The most recent guard outcome, or `null` when the guard has not run yet.
 * Read by the readiness/health path so a wrong role stays observable after the
 * one boot-time log line has scrolled away.
 */
export function getRoleGuardStatus(): RoleGuardStatus | null {
  return lastStatus;
}

/** Test-only: clears the memoised outcome. */
export function resetRoleGuardStatus(): void {
  lastStatus = null;
}

export interface RoleGuardDeps {
  /** Read env (defaults to `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Query runner (defaults to the app pool). */
  runQuery?: <T extends Record<string, unknown>>(sql: string) => Promise<{ rows: T[] }>;
  /** Alert fan-out (defaults to `sendCriticalErrorAlert`). */
  notify?: (payload: { error: unknown; level: string; context: string }) => Promise<void>;
  /** Logger (defaults to `console`). */
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
 * Check the connecting role once, loudly, without ever taking the app down.
 *
 * A second call is free: the verdict is memoised (the role behind a given
 * `DATABASE_URL` cannot change while the process lives), so the health endpoint
 * can surface `getRoleGuardStatus()` without re-querying per request.
 */
export async function guardConnectionRole(deps: RoleGuardDeps = {}): Promise<RoleGuardStatus> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? console;
  const runQuery = deps.runQuery ?? (<T extends Record<string, unknown>>(sql: string) => query<T>(sql));
  const notify = deps.notify ?? defaultNotify;

  if (env[RLS_ROLE_GUARD_ENV] === 'false') {
    lastStatus = { state: 'disabled', detail: `${RLS_ROLE_GUARD_ENV}=false` };
    log.warn(
      `[rls-role-guard] DISABLED by ${RLS_ROLE_GUARD_ENV}=false — tenant isolation is NOT verified for the role this process connects as (#2306).`,
    );
    return lastStatus;
  }

  if (!env.DATABASE_URL) {
    lastStatus = { state: 'skipped', detail: 'DATABASE_URL not set' };
    return lastStatus;
  }
  if (env.NEXT_PHASE?.includes('build') || env.NODE_ENV === 'test') {
    // The build worker must not touch Postgres; unit tests only reach this
    // module through explicit injection.
    lastStatus = { state: 'skipped', detail: 'build/test context' };
    return lastStatus;
  }

  try {
    const verdict = await assertRoleIsRlsConstrained(runQuery);
    lastStatus = { state: 'ok', rolname: extractRolname(verdict) };
    log.log(`[rls-role-guard] OK — RLS is enforced against role "${lastStatus.rolname}".`);
    return lastStatus;
  } catch (err) {
    const message = redactConnectionString(err instanceof Error ? err.message : String(err));

    if (err instanceof RlsRoleBypassError) {
      lastStatus = { state: 'violation', message };
      log.error('\n' + '='.repeat(72));
      log.error('[rls-role-guard] FATAL INVARIANT VIOLATION (#2306):');
      log.error(`  ${message}`);
      log.error(
        '  The app will keep serving, but EVERY tenant_isolation policy is a no-op for this ' +
          'connection: isolation now rests on application WHERE clauses alone. Point DATABASE_URL at a ' +
          'non-superuser, non-BYPASSRLS role (see scripts/provision-app-role.mjs) and restart.',
      );
      log.error('='.repeat(72) + '\n');
    } else {
      lastStatus = { state: 'error', message };
      log.error(`[rls-role-guard] could not verify the connecting role: ${message}`);
    }

    await notify({
      error: new Error(message),
      level: lastStatus.state === 'violation' ? 'fatal' : 'error',
      context: 'db-role-rls-guard',
    }).catch(() => {
      log.error('[rls-role-guard] alert fan-out failed — the violation above still stands.');
    });

    return lastStatus;
  }
}

function extractRolname(verdict: RolePrivilegeVerdict): string {
  const match = /role "([^"]+)"/.exec(verdict.findings.map((f) => f.message).join(' '));
  return match?.[1] ?? 'unknown';
}
