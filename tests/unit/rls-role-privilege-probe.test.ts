/**
 * #2306 — the single source of truth for the "connecting role must be subject to
 * RLS" invariant must work without a database, because its three consumers (the
 * deploy gate in .github/workflows/deploy.yml, the nightly guards in
 * .github/workflows/nightly-soak.yml and the startup hook in
 * lib/db/role-privilege-guard.ts) all call the same probe/assert pair.
 *
 * These tests drive `collectRolePrivilegeFacts` / `assertRoleIsRlsConstrained`
 * with a stubbed querier, so the SQL contract (which statement is asked for what)
 * and the message hygiene (never leak a connection string) are both pinned.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  assertRoleIsRlsConstrained,
  collectRolePrivilegeFacts,
  redactConnectionString,
  RlsRoleBypassError,
  ROLE_PRIVILEGE_SQL,
  TENANT_TABLE_OWNERSHIP_SQL,
  type RolePrivilegeQuerier,
} from '@/lib/db/least-privilege';

/** Stub querier: answers the two probes this module defines, nothing else. */
function fakeDb(opts: {
  rolname?: string;
  rolsuper?: boolean | null;
  rolbypassrls?: boolean | null;
  owned?: number;
  unforcedOwned?: number;
  noRoleRow?: boolean;
  ownershipFails?: boolean;
}): { run: RolePrivilegeQuerier; calls: string[] } {
  const calls: string[] = [];
  const run = vi.fn(async <T extends Record<string, unknown>>(sql: string) => {
    calls.push(sql);
    if (sql === ROLE_PRIVILEGE_SQL) {
      if (opts.noRoleRow) return { rows: [] as T[] };
      return {
        rows: [
          {
            rolname: opts.rolname ?? 'postgres',
            rolsuper: opts.rolsuper ?? false,
            rolbypassrls: opts.rolbypassrls ?? false,
          } as unknown as T,
        ],
      };
    }
    if (sql === TENANT_TABLE_OWNERSHIP_SQL) {
      if (opts.ownershipFails) throw new Error('permission denied for catalog');
      return {
        rows: [{ owned: opts.owned ?? 0, unforced_owned: opts.unforcedOwned ?? 0 } as unknown as T],
      };
    }
    throw new Error(`unexpected SQL passed to the guard probe: ${sql.slice(0, 60)}`);
  }) as unknown as RolePrivilegeQuerier;
  return { run, calls };
}

describe('collectRolePrivilegeFacts (Issue #2306)', () => {
  it('asks the connection for exactly the role + ownership probes', async () => {
    const { run, calls } = fakeDb({});
    const facts = await collectRolePrivilegeFacts(run);

    expect(calls).toEqual([ROLE_PRIVILEGE_SQL, TENANT_TABLE_OWNERSHIP_SQL]);
    expect(facts.rolname).toBe('postgres');
    expect(facts.rolsuper).toBe(false);
    expect(facts.ownsTenantTables).toBe(0);
  });

  it('surfaces superuser and BYPASSRLS as booleans, never as nulls', async () => {
    const { run } = fakeDb({ rolsuper: true, rolbypassrls: null });
    const facts = await collectRolePrivilegeFacts(run);

    expect(facts.rolsuper).toBe(true);
    expect(facts.rolbypassrls).toBe(false);
  });

  it('treats an unreadable ownership probe as unknown instead of failing the verdict', async () => {
    const { run } = fakeDb({ ownershipFails: true });
    const facts = await collectRolePrivilegeFacts(run);

    expect(facts.ownsTenantTables).toBeNull();
    expect(facts.hasUnforcedTables).toBeNull();
  });

  it('refuses to guess when the connecting role cannot be determined', async () => {
    const { run } = fakeDb({ noRoleRow: true });
    await expect(collectRolePrivilegeFacts(run)).rejects.toThrow(RlsRoleBypassError);
  });
});

describe('assertRoleIsRlsConstrained (Issue #2306)', () => {
  it('throws for a superuser role and names the remedy', async () => {
    const { run } = fakeDb({ rolname: 'postgres', rolsuper: true });
    await expect(assertRoleIsRlsConstrained(run)).rejects.toThrow(/SUPERUSER/);
    await expect(assertRoleIsRlsConstrained(run)).rejects.toThrow(/nucrm_app/);
  });

  it('throws for a BYPASSRLS-only role', async () => {
    const { run } = fakeDb({ rolname: 'migrator', rolsuper: false, rolbypassrls: true });
    await expect(assertRoleIsRlsConstrained(run)).rejects.toThrow(/BYPASSRLS/);
  });

  it('throws for the owner-exempt case (owns tenant tables that are not FORCE RLS)', async () => {
    const { run } = fakeDb({ rolname: 'nucrm', owned: 4, unforcedOwned: 4 });
    await expect(assertRoleIsRlsConstrained(run)).rejects.toThrow(/FORCE ROW LEVEL SECURITY/);
  });

  it('returns the verdict for a genuinely constrained role', async () => {
    const { run } = fakeDb({ rolname: 'nucrm_app', owned: 0 });
    const verdict = await assertRoleIsRlsConstrained(run);

    expect(verdict.ok).toBe(true);
    expect(verdict.failures).toEqual([]);
    expect(verdict.findings.some((f) => f.code === 'enforced')).toBe(true);
  });

  it('carries the blocking findings on the error so callers can log them', async () => {
    const { run } = fakeDb({ rolsuper: true, rolbypassrls: true });
    try {
      await assertRoleIsRlsConstrained(run);
      throw new Error('assertRoleIsRlsConstrained should have rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(RlsRoleBypassError);
      const codes = (err as RlsRoleBypassError).verdict?.failures.map((f) => f.code) ?? [];
      expect(codes).toEqual(['superuser', 'bypassrls']);
    }
  });

  it('never lets a connection string into the thrown message', async () => {
    const run = vi.fn(async <T extends Record<string, unknown>>(sql: string) => {
      if (sql === TENANT_TABLE_OWNERSHIP_SQL) {
        return { rows: [{ owned: 0, unforced_owned: 0 } as unknown as T] };
      }
      return {
        rows: [
          { rolname: 'app_owner', rolsuper: true, rolbypassrls: false } as unknown as T,
        ],
      };
    }) as unknown as RolePrivilegeQuerier;

    await expect(assertRoleIsRlsConstrained(run)).rejects.toThrow(
      /^RLS IS NOT ENFORCED against the connecting role\./,
    );
    await expect(assertRoleIsRlsConstrained(run)).rejects.not.toThrow(/postgres|postgresql:\/\//);
  });
});

describe('redactConnectionString (Issue #2306)', () => {
  it('removes the whole URL from a driver error message', () => {
    const raw =
      'connection to "postgresql://app_owner:S3cr3t-Passw0rd@db.internal:5432/nucrm" was refused';
    const out = redactConnectionString(raw);

    expect(out).not.toContain('S3cr3t-Passw0rd');
    expect(out).not.toContain('db.internal');
    expect(out).toContain('[redacted-connection-string]');
    expect(out).toContain('was refused');
  });

  it('masks bare authority segments too', () => {
    expect(redactConnectionString('see postgres://u:pw@h/d for details')).not.toContain('u:pw@h');
  });
});
