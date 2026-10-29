import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const end = vi.fn();

vi.mock('pg', () => {
  const MockPool = vi.fn(function MockPool() {
    return { query, end, on: vi.fn() };
  });
  return { Pool: MockPool, default: { Pool: MockPool } };
});

const spawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawn(...args),
  exec: (
    _cmd: string,
    _opts: unknown,
    cb: (err: null, stdout: string, stderr: string) => void,
  ) => cb(null, 'pg_dump (PostgreSQL) 18.6', ''),
}));

/**
 * `node-postgres` names each result field after the column the *server returned*
 * (an alias if there is one, else the bare column), not after whatever the
 * `query<T>` generic claims. So the mock below derives its row keys from the SQL
 * the guard actually sent: a `{ super, bypass }` literal would have kept passing
 * while the real driver returned `rolsuper`/`rolbypassrls` (#3254).
 */
function returnedColumns(sqlText: string): { name: string; attr: string }[] {
  const selectList = sqlText.replace(/^[\s\S]*?\bselect\b\s+/i, '').split(/\bfrom\b/i)[0];
  return selectList.split(',').map((item) => {
    const expr = item.replace(/\bas\s+[A-Za-z_][\w$]*\s*$/i, '').trim();
    const alias = item.match(/\bas\s+([A-Za-z_][\w$]*)\s*$/i)?.[1] ?? expr.split('.').pop()!.trim();
    const attr = /rolsuper/i.test(expr)
      ? 'rolsuper'
      : /rolbypassrls/i.test(expr)
        ? 'rolbypassrls'
        : 'role';
    return { name: alias, attr };
  });
}

function roleResult(role: string, superuser: boolean, bypass: boolean) {
  return async (sqlText: string) => {
    const attrs: Record<string, unknown> = { role, rolsuper: superuser, rolbypassrls: bypass };
    return {
      rows: [Object.fromEntries(returnedColumns(sqlText).map((c) => [c.name, attrs[c.attr]]))],
    };
  };
}

function childThatExits(code: number) {
  return {
    stderr: { on: vi.fn() },
    stdout: { on: vi.fn() },
    on: (event: string, cb: (arg: unknown) => void) => {
      if (event === 'close') setTimeout(() => cb(code), 0);
    },
  };
}

describe('backup dump-role guard (PP-014/PP-015)', () => {
  beforeEach(() => {
    vi.resetModules();
    query.mockReset();
    end.mockReset();
    spawn.mockReset();
    process.env['DATABASE_URL'] = 'postgresql://nucrm:secret@db.internal:5432/nucrm';
    delete process.env['BACKUP_DATABASE_URL'];
    process.env['DATABASE_SSL'] = 'false';
    process.env['BACKUP_LOCAL_DIR'] = '/tmp/nucrm-backups';
  });

  it('refuses to dump as a FORCE-RLS-restricted role instead of writing an empty backup', async () => {
    query.mockImplementation(roleResult('nucrm', false, false));
    const { runPgDump } = await import('@/lib/backups/backup-service');

    await expect(runPgDump('full', '/tmp/nucrm-backups/x.dump')).rejects.toThrow(/BYPASSRLS/);
    expect(spawn).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalled();
  });

  it('names the offending role in the error', async () => {
    query.mockImplementation(roleResult('nucrm_ro', false, false));
    const { assertDumpRoleCanReadAllTenants } = await import('@/lib/backups/backup-service');

    await expect(assertDumpRoleCanReadAllTenants(process.env['DATABASE_URL']!)).rejects.toThrow(
      /role "nucrm_ro"/,
    );
  });

  it('proceeds when the role can bypass RLS', async () => {
    query.mockImplementation(roleResult('nucrm_backup', false, true));
    spawn.mockReturnValue(childThatExits(0));
    const { runPgDump } = await import('@/lib/backups/backup-service');

    await expect(runPgDump('full', '/tmp/nucrm-backups/x.dump')).resolves.toBeUndefined();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('accepts a cluster superuser as the real driver reports it (#3254)', async () => {
    query.mockImplementation(roleResult('postgres', true, false));
    const { assertDumpRoleCanReadAllTenants } = await import('@/lib/backups/backup-service');

    await expect(
      assertDumpRoleCanReadAllTenants(process.env['DATABASE_URL']!),
    ).resolves.toBeUndefined();
  });

  it('names an unreadable pg_roles shape as a shape failure, not a lack of permission', async () => {
    query.mockResolvedValue({ rows: [{ role: 'nucrm_backup' }] });
    const { assertDumpRoleCanReadAllTenants } = await import('@/lib/backups/backup-service');

    await expect(assertDumpRoleCanReadAllTenants(process.env['DATABASE_URL']!)).rejects.toThrow(
      /shape/,
    );
    await expect(assertDumpRoleCanReadAllTenants(process.env['DATABASE_URL']!)).rejects.not.toThrow(
      /neither superuser nor BYPASSRLS/,
    );
  });

  it('aliases every column it reads, so the guard cannot read `undefined` as a denial', async () => {
    query.mockImplementation(roleResult('postgres', true, false));
    const { assertDumpRoleCanReadAllTenants } = await import('@/lib/backups/backup-service');

    await assertDumpRoleCanReadAllTenants(process.env['DATABASE_URL']!);

    const sql = query.mock.calls.at(-1)![0] as string;
    expect(returnedColumns(sql).map((c) => c.name).sort()).toEqual(['bypass', 'role', 'super']);
  });

  it('passes credentials through the environment, never as a pg_dump argument', async () => {
    query.mockImplementation(roleResult('postgres', true, false));
    spawn.mockReturnValue(childThatExits(0));
    const { runPgDump } = await import('@/lib/backups/backup-service');

    await runPgDump('full', '/tmp/nucrm-backups/x.dump');

    const [cmd, args, opts] = spawn.mock.calls[0] as [
      string,
      string[],
      { env: Record<string, string> },
    ];
    expect(cmd).toBe('pg_dump');
    expect(args.join(' ')).not.toContain('secret');
    expect(args.join(' ')).not.toContain('postgresql://');
    expect(opts.env.PGUSER).toBe('nucrm');
    expect(opts.env.PGPASSWORD).toBe('secret');
    expect(opts.env.PGDATABASE).toBe('nucrm');
  });

  it('prefers BACKUP_DATABASE_URL for both the check and the dump', async () => {
    process.env['BACKUP_DATABASE_URL'] = 'postgresql://upadmin:pw@db.internal:5432/nucrm';
    query.mockImplementation(roleResult('upadmin', true, false));
    spawn.mockReturnValue(childThatExits(0));
    const { runPgDump } = await import('@/lib/backups/backup-service');

    await runPgDump('full', '/tmp/nucrm-backups/x.dump');

    const { Pool } = await import('pg');
    const MockPool = Pool as unknown as { mock: { calls: [{ connectionString: string }][] } };
    expect(MockPool.mock.calls[0]?.[0]?.connectionString).toBe(
      'postgresql://upadmin:pw@db.internal:5432/nucrm',
    );
    expect(spawn.mock.calls[0]?.[2]?.env).toMatchObject({ PGUSER: 'upadmin' });
  });

  it('treats an unverifiable role as no-permission at all (fail closed)', async () => {
    query.mockResolvedValue({ rows: [] });
    const { assertDumpRoleCanReadAllTenants } = await import('@/lib/backups/backup-service');

    await expect(assertDumpRoleCanReadAllTenants(process.env['DATABASE_URL']!)).rejects.toThrow(
      /does not exist in pg_roles/,
    );
    expect(end).toHaveBeenCalled();
  });

  it('never leaks the connection password in the fail-closed error', async () => {
    const { assertDumpRoleCanReadAllTenants } = await import('@/lib/backups/backup-service');
    query.mockResolvedValue({ rows: [] });

    await expect(assertDumpRoleCanReadAllTenants(process.env['DATABASE_URL']!)).rejects.not.toThrow(
      'secret',
    );
  });
});
