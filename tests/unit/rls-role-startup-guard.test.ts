/**
 * #2306 — the startup connection-role guard.
 *
 * The invariant itself is covered by rls-role-privilege-probe.test.ts; what is
 * pinned here is the *behaviour of the hook in a live process*:
 *
 *   1. A violation is never swallowed — it is logged, pushed through the
 *      critical-alert fan-out, and returned as a non-`ok` status.
 *   2. It never kills the process: a running app is taken down by exiting, not
 *      by a role attribute.
 *   3. It is default-on, and off only via the explicit `RLS_ROLE_GUARD=false`
 *      flag — the same convention `lib/db/ssl-config.ts` uses for DATABASE_SSL.
 *   4. It cannot leak the connection string, because `pg` errors echo the URL.
 *
 * The querier, notifier and logger are all injected, so no database is touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  guardConnectionRole,
  resetRoleGuardStatus,
  getRoleGuardStatus,
  RLS_ROLE_GUARD_ENV,
  type RoleGuardDeps,
} from '@/lib/db/role-privilege-guard';
import { ROLE_PRIVILEGE_SQL, TENANT_TABLE_OWNERSHIP_SQL } from '@/lib/db/least-privilege';

const LIVE_ENV = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://x/y' } as unknown as NodeJS.ProcessEnv;

function dbReturning(role: {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  owned?: number;
  unforcedOwned?: number;
}) {
  return vi.fn(async <T extends Record<string, unknown>>(sql: string) => {
    if (sql === TENANT_TABLE_OWNERSHIP_SQL) {
      return { rows: [{ owned: role.owned ?? 0, unforced_owned: role.unforcedOwned ?? 0 } as unknown as T] };
    }
    return {
      rows: [{ rolname: role.rolname, rolsuper: role.rolsuper, rolbypassrls: role.rolbypassrls } as unknown as T],
    };
  }) as unknown as RolePrivilegeQuerierLike;
}

type RolePrivilegeQuerierLike = NonNullable<RoleGuardDeps['runQuery']>;

function harness(overrides: Partial<RoleGuardDeps> = {}) {
  const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const notify = vi.fn(async () => {});
  return {
    log,
    notify,
    runQuery: overrides.runQuery ?? dbReturning({ rolname: 'nucrm_app', rolsuper: false, rolbypassrls: false }),
    deps: {
      env: overrides.env ?? LIVE_ENV,
      runQuery: overrides.runQuery ?? dbReturning({ rolname: 'nucrm_app', rolsuper: false, rolbypassrls: false }),
      notify: overrides.notify ?? notify,
      log: overrides.log ?? log,
    } satisfies RoleGuardDeps,
  };
}

beforeEach(() => {
  resetRoleGuardStatus();
  vi.restoreAllMocks();
});

describe('guardConnectionRole — the invariant is enforced at boot (#2306)', () => {
  it('passes a constrained role and records the outcome for the health path', async () => {
    const h = harness();
    const status = await guardConnectionRole(h.deps);

    expect(status).toEqual({ state: 'ok', rolname: 'nucrm_app' });
    expect(getRoleGuardStatus()).toEqual(status);
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.log.log).toHaveBeenCalledWith(expect.stringContaining('RLS is enforced against role "nucrm_app"'));
  });

  it('turns a superuser connection into a loud alert instead of a silent boot', async () => {
    const h = harness({ runQuery: dbReturning({ rolname: 'postgres', rolsuper: true, rolbypassrls: true }) });
    const status = await guardConnectionRole(h.deps);

    expect(status.state).toBe('violation');
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'fatal', context: 'db-role-rls-guard' }),
    );
    const logged = h.log.error.mock.calls.flat().join('\n');
    expect(logged).toContain('FATAL INVARIANT VIOLATION (#2306)');
    expect(logged).toContain('SUPERUSER');
    expect(logged).toContain('provision-app-role');
  });

  it('flags a BYPASSRLS role even when it is not a superuser', async () => {
    const h = harness({
      runQuery: dbReturning({ rolname: 'migrator', rolsuper: false, rolbypassrls: true }),
    });
    const status = await guardConnectionRole(h.deps);

    expect(status.state).toBe('violation');
    expect((status as { message: string }).message).toContain('BYPASSRLS');
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it('does not swallow the condition: it neither throws to the caller nor exits the process', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const h = harness({ runQuery: dbReturning({ rolname: 'postgres', rolsuper: true, rolbypassrls: false }) });

    await expect(guardConnectionRole(h.deps)).resolves.toMatchObject({ state: 'violation' });
    expect(exitSpy).not.toHaveBeenCalled();
    expect(getRoleGuardStatus()!.state).toBe('violation');
  });

  it('keeps a DB error visible (state=error + alert) rather than degrading to silence', async () => {
    const h = harness({
      runQuery: vi.fn(async () => {
        throw new Error('connect ECONNREFUSED postgresql://app:sup3rs3cr3t@db.prod:5432/nucrm');
      }) as unknown as RolePrivilegeQuerierLike,
    });
    const status = await guardConnectionRole(h.deps);

    expect(status.state).toBe('error');
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ context: 'db-role-rls-guard' }));
    const reported = [
      h.log.error.mock.calls.flat().join('\n'),
      (h.notify.mock.calls[0] as unknown as [{ error: Error }])[0].error.message,
    ].join('\n');
    expect(reported).not.toContain('sup3rs3cr3t');
    expect(reported).toContain('ECONNREFUSED');
  });

  it('is default-on and only ever disabled by the explicit env flag', async () => {
    const runQuery = dbReturning({ rolname: 'postgres', rolsuper: true, rolbypassrls: false });
    const off = harness({ runQuery });

    const status = await guardConnectionRole({
      ...off.deps,
      env: { ...LIVE_ENV, [RLS_ROLE_GUARD_ENV]: 'false' },
    });

    expect(status.state).toBe('disabled');
    expect(runQuery).not.toHaveBeenCalled();
    expect(off.log.warn).toHaveBeenCalledWith(expect.stringContaining(`${RLS_ROLE_GUARD_ENV}=false`));

    // Anything but the literal 'false' keeps the guard on — a typo cannot disable it.
    const stillOn = harness({ runQuery: dbReturning({ rolname: 'postgres', rolsuper: true, rolbypassrls: false }) });
    await expect(
      guardConnectionRole({ ...stillOn.deps, env: { ...LIVE_ENV, [RLS_ROLE_GUARD_ENV]: 'no' } }),
    ).resolves.toMatchObject({ state: 'violation' });
  });

  it('skips the build worker and an unconfigured process without probing', async () => {
    const noUrl = harness({ env: { NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv });
    await expect(guardConnectionRole(noUrl.deps)).resolves.toMatchObject({ state: 'skipped' });
    expect(noUrl.runQuery).not.toHaveBeenCalled();

    const buildPhase = harness({
      env: { ...LIVE_ENV, NEXT_PHASE: 'phase-build' } as unknown as NodeJS.ProcessEnv,
    });
    await expect(guardConnectionRole(buildPhase.deps)).resolves.toMatchObject({ state: 'skipped' });
    expect(buildPhase.runQuery).not.toHaveBeenCalled();
  });

  it('reads the same two probes the nightly and the deploy gate read (single source of truth)', async () => {
    const runQuery = dbReturning({ rolname: 'nucrm_app', rolsuper: false, rolbypassrls: false });
    const h = harness({ runQuery });
    await guardConnectionRole(h.deps);

    const sqls = (
      runQuery as unknown as { mock: { calls: Array<[string]> } }
    ).mock.calls.map((c) => c[0]);
    expect(sqls).toEqual([ROLE_PRIVILEGE_SQL, TENANT_TABLE_OWNERSHIP_SQL]);
  });
});
