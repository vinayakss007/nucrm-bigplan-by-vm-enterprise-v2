/**
 * Regression tests for the silent-catch fixes (issue #676).
 *
 * Each of these call sites used to swallow its error (empty catch or
 * console.error). The contract now is: report the failure through the
 * structured reporter AND keep the previous fallback behaviour, so a broken
 * dependency is visible without turning a degraded read into a hard failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { chain, dbState, mocks } = vi.hoisted(() => {
  interface QueryChain extends PromiseLike<unknown> {
    from(): QueryChain;
    where(): QueryChain;
    orderBy(): QueryChain;
    limit(): QueryChain;
  }

  const dbState = {
    /** Resolver used by every `db.select()...` chain. */
    select: (() => Promise.resolve([] as unknown)) as () => Promise<unknown>,
  };

  /**
   * A thenable chain that satisfies all the drizzle query shapes used by the
   * modules under test: `.from().where()`, `.from().where().limit()` and
   * `.from().where().orderBy().limit()`.
   */
  function chain(run: () => Promise<unknown>): QueryChain {
    const c: QueryChain = {
      from: () => c,
      where: () => c,
      orderBy: () => c,
      limit: () => c,
      then: (onFulfilled, onRejected) => run().then(onFulfilled, onRejected),
    };
    return c;
  }

  const mocks = {
    insertValues: vi.fn(),
    execute: vi.fn(),
    findFirst: vi.fn(),
    loggerError: vi.fn(),
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
    logError: vi.fn(),
  };

  return { chain, dbState, mocks };
});

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => chain(() => dbState.select()),
    insert: () => ({ values: mocks.insertValues }),
    execute: mocks.execute,
    query: { systemSettings: { findFirst: mocks.findFirst } },
  },
}));

vi.mock('@/drizzle/schema', () => ({
  users: {},
  tenants: {},
  systemSettings: {},
  auditLogs: {},
  customFieldDefs: {},
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError, info: mocks.loggerInfo, warn: mocks.loggerWarn },
  safeError: vi.fn(),
}));

vi.mock('@/lib/errors-client', () => ({
  logError: mocks.logError,
}));

import { getUserDefaultView } from '@/lib/user-defaults';
import { getConfirmDestructivePref, getPref, clearPrefsCache } from '@/lib/client-prefs';
import { getDlpConfig, logExportActivity } from '@/lib/dlp';
import { syncCalculatedFields } from '@/lib/formula/sync';
import { logAudit } from '@/lib/audit';

/** Every logger.error message, joined, for loose assertions. */
function loggedMessages(): string {
  return mocks.loggerError.mock.calls.map((c) => String(c[0])).join('\n');
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.select = () => Promise.resolve([]);
  mocks.insertValues.mockResolvedValue(undefined);
  mocks.execute.mockResolvedValue(undefined);
  mocks.findFirst.mockResolvedValue(undefined);
  clearPrefsCache();
});

describe('lib/user-defaults getUserDefaultView', () => {
  it('reports the DB error and still returns the list fallback', async () => {
    dbState.select = () => Promise.reject(new Error('connection terminated'));

    const result = await getUserDefaultView('tenant-1', 'user-1');

    expect(result).toBe('list');
    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
    expect(loggedMessages()).toContain('user-defaults');
    const meta = mocks.loggerError.mock.calls[0]![1] as Record<string, unknown>;
    expect(meta).toMatchObject({ tenantId: 'tenant-1', userId: 'user-1' });
    expect(String(meta.error)).toContain('connection terminated');
  });

  it('does not log on the happy path', async () => {
    dbState.select = () => Promise.resolve([{ metadata: { prefs: { default_record_view: 'kanban' } } }]);

    expect(await getUserDefaultView('tenant-1', 'user-1')).toBe('kanban');
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });
});

describe('lib/client-prefs fetchPrefs', () => {
  it('reports a rejected fetch via logError and still resolves to defaults', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('NetworkError: failed to fetch'));

    const pref = await getConfirmDestructivePref();

    expect(pref).toBe('always');
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const arg = mocks.logError.mock.calls[0]![0] as { error: unknown; context?: string };
    expect(arg.context).toBe('client-prefs:fetchPrefs');
    expect((arg.error as Error).message).toContain('failed to fetch');

    fetchSpy.mockRestore();
  });

  it('reports once and still returns undefined for an individual pref lookup', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    expect(await getPref('theme')).toBeUndefined();
    expect(mocks.logError).toHaveBeenCalledTimes(1);

    fetchSpy.mockRestore();
  });

  it('does not report when the fetch succeeds', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ preferences: { confirm_destructive: 'never' } }),
    } as Response);

    expect(await getConfirmDestructivePref()).toBe('never');
    expect(mocks.logError).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});

describe('lib/dlp getDlpConfig', () => {
  it('reports the DB error and still returns the default config', async () => {
    mocks.findFirst.mockRejectedValue(new Error('relation "system_settings" does not exist'));

    const config = await getDlpConfig('tenant-9');

    expect(config).toEqual({
      // getDlpConfig echoes the requested tenant back on the default config
      // (added when DLP config became tenant-aware in #673/#683).
      tenantId: 'tenant-9',
      maskSensitiveFields: true,
      logExports: true,
      maxExportRows: 10000,
      allowedExportFormats: ['csv', 'xlsx', 'json'],
      sensitiveFieldOverrides: [],
    });
    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
    expect(loggedMessages()).toContain('DLP');
    const meta = mocks.loggerError.mock.calls[0]![1] as Record<string, unknown>;
    expect(meta.tenantId).toBe('tenant-9');
    expect(String(meta.error)).toContain('system_settings');
  });

  it('does not log when the config loads', async () => {
    mocks.findFirst.mockResolvedValue({ value: { maxExportRows: 5 } });

    const config = await getDlpConfig('tenant-9');

    expect(config.maxExportRows).toBe(5);
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });
});

describe('lib/dlp logExportActivity', () => {
  it('reports the DB error through the logger instead of console and does not throw', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.insertValues.mockRejectedValue(new Error('insert failed'));

    await expect(
      logExportActivity('tenant-1', 'user-1', 'contacts', 'csv', 42, ['email'], '10.0.0.1'),
    ).resolves.toBeUndefined();

    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
    expect(loggedMessages()).toContain('DLP');
    const meta = mocks.loggerError.mock.calls[0]![1] as Record<string, unknown>;
    expect(meta).toMatchObject({
      tenantId: 'tenant-1',
      userId: 'user-1',
      exportType: 'contacts',
      format: 'csv',
      rowCount: 42,
    });
    // The fix moved this off console.error onto the structured logger.
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('does not log when the export record is written', async () => {
    await logExportActivity('tenant-1', 'user-1', 'contacts', 'csv', 1, []);
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });
});

describe('lib/formula/sync syncCalculatedFields', () => {
  it('reports the DB error through the logger instead of console and does not throw', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    dbState.select = () => Promise.reject(new Error('deadlock detected'));

    await expect(
      syncCalculatedFields('tenant-3', 'contact', 'contact-3', { amount: 100 }),
    ).resolves.toBeUndefined();

    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
    expect(loggedMessages()).toContain('FormulaSync');
    const meta = mocks.loggerError.mock.calls[0]![1] as Record<string, unknown>;
    expect(meta).toMatchObject({
      tenantId: 'tenant-3',
      entityType: 'contact',
      entityId: 'contact-3',
    });
    expect(String(meta.error)).toContain('deadlock detected');
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('reports a failure of the metadata UPDATE itself', async () => {
    dbState.select = () =>
      Promise.resolve([{ fieldKey: 'commission', formula: '{{amount}} * 0.1' }]);
    mocks.execute.mockRejectedValue(new Error('update failed'));

    await expect(
      syncCalculatedFields('tenant-4', 'deal', 'deal-4', { amount: 1000 }),
    ).resolves.toBeUndefined();

    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
    expect(loggedMessages()).toContain('FormulaSync');
  });

  it('does not log when the sync succeeds', async () => {
    dbState.select = () =>
      Promise.resolve([{ fieldKey: 'commission', formula: '{{amount}} * 0.1' }]);

    await syncCalculatedFields('tenant-5', 'deal', 'deal-5', { amount: 1000 });

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });
});

describe('lib/audit logAudit', () => {
  /** A caller-supplied transaction whose audit write fails. */
  function failingTx(error: Error) {
    return {
      select: () => chain(() => Promise.reject(error)),
      insert: () => ({ values: vi.fn() }),
    };
  }

  it('logs and does NOT throw when called standalone', async () => {
    dbState.select = () => Promise.reject(new Error('audit table unavailable'));

    await expect(
      logAudit({ tenantId: 'tenant-1', action: 'update', entityType: 'deal', entityId: 'deal-1' }),
    ).resolves.toBeUndefined();

    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
    expect(loggedMessages()).toContain('audit');
    const meta = mocks.loggerError.mock.calls[0]![1] as Record<string, unknown>;
    expect(meta).toMatchObject({
      tenantId: 'tenant-1',
      action: 'update',
      entityType: 'deal',
      transactional: false,
    });
  });

  it('logs AND re-throws when the caller provided dbOrTx', async () => {
    const error = new Error('tx audit write failed');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = failingTx(error) as any;

    await expect(
      logAudit({
        tenantId: 'tenant-1',
        action: 'delete',
        entityType: 'contact',
        entityId: 'contact-1',
        dbOrTx: tx,
      }),
    ).rejects.toThrow('tx audit write failed');

    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
    const meta = mocks.loggerError.mock.calls[0]![1] as Record<string, unknown>;
    expect(meta.transactional).toBe(true);
  });

  it('re-throws a failing insert inside a caller transaction', async () => {
    const tx = {
      select: () => chain(() => Promise.resolve([{ hash: 'prev-hash' }])),
      insert: () => ({ values: () => Promise.reject(new Error('insert in tx failed')) }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await expect(
      logAudit({ tenantId: 'tenant-1', action: 'create', entityType: 'deal', dbOrTx: tx }),
    ).rejects.toThrow('insert in tx failed');
    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
  });

  it('does not log or throw on the happy path', async () => {
    dbState.select = () => Promise.resolve([{ hash: 'prev-hash' }]);

    await logAudit({ tenantId: 'tenant-1', action: 'create', entityType: 'deal' });

    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });
});
