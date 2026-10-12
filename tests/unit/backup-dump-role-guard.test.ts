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

function roleRow(role: string, superuser: boolean, bypass: boolean) {
  return { rows: [{ role, super: superuser, bypass }] };
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
    query.mockResolvedValue(roleRow('nucrm', false, false));
    const { runPgDump } = await import('@/lib/backups/backup-service');

    await expect(runPgDump('full', '/tmp/nucrm-backups/x.dump')).rejects.toThrow(/BYPASSRLS/);
    expect(spawn).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalled();
  });

  it('names the offending role in the error', async () => {
    query.mockResolvedValue(roleRow('nucrm_ro', false, false));
    const { assertDumpRoleCanReadAllTenants } = await import('@/lib/backups/backup-service');

    await expect(assertDumpRoleCanReadAllTenants(process.env['DATABASE_URL']!)).rejects.toThrow(
      /role "nucrm_ro"/,
    );
  });

  it('proceeds when the role can bypass RLS', async () => {
    query.mockResolvedValue(roleRow('nucrm_backup', false, true));
    spawn.mockReturnValue(childThatExits(0));
    const { runPgDump } = await import('@/lib/backups/backup-service');

    await expect(runPgDump('full', '/tmp/nucrm-backups/x.dump')).resolves.toBeUndefined();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('passes credentials through the environment, never as a pg_dump argument', async () => {
    query.mockResolvedValue(roleRow('postgres', true, false));
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
    query.mockResolvedValue(roleRow('upadmin', true, false));
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
