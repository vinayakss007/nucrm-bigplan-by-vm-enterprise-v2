import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn().mockResolvedValue({ rows: [] });

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: mockExecute,
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    transaction: vi.fn(async (cb: any) => {
      const tx = { execute: vi.fn() };
      return cb(tx);
    }),
  },
}));

describe('db/rls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('setTenantContext', () => {
    it('sets tenant and user context', async () => {
      const { setTenantContext } = await import('@/lib/db/rls');
      await setTenantContext('tenant-123', 'user-456');
      expect(mockExecute).toHaveBeenCalled();
    });

    it('throws on database error', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB error'));
      const { setTenantContext } = await import('@/lib/db/rls');
      await expect(setTenantContext('tenant-123', 'user-456')).rejects.toThrow('DB error');
    });

    it('rejects empty tenantId', async () => {
      const { setTenantContext } = await import('@/lib/db/rls');
      await expect(setTenantContext('', 'user-456')).rejects.toThrow('empty tenantId');
    });

    it('rejects empty userId', async () => {
      const { setTenantContext } = await import('@/lib/db/rls');
      await expect(setTenantContext('tenant-123', '')).rejects.toThrow('empty tenantId or userId');
    });
  });

  describe('clearTenantContext', () => {
    it('clears tenant context by setting empty values', async () => {
      const { clearTenantContext } = await import('@/lib/db/rls');
      await clearTenantContext();
      expect(mockExecute).toHaveBeenCalled();
    });

    it('does not throw on error', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB error'));
      const { clearTenantContext } = await import('@/lib/db/rls');
      await expect(clearTenantContext()).resolves.not.toThrow();
    });
  });

  describe('withTenantContext', () => {
    it('executes function with tenant context in transaction', async () => {
      const { withTenantContext } = await import('@/lib/db/rls');
      const fn = vi.fn().mockResolvedValue({ id: 1, name: 'test' });
      const result = await withTenantContext('tenant-123', 'user-456', fn);
      expect(result).toEqual({ id: 1, name: 'test' });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('rejects empty tenantId', async () => {
      const { withTenantContext } = await import('@/lib/db/rls');
      const fn = vi.fn();
      await expect(withTenantContext('', 'user-456', fn)).rejects.toThrow('empty tenantId or userId');
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe.each([
    ['security', 'app.is_super_admin'],
    ['lookup', 'app.auth_lookup'],
    ['tracking lookup', 'app.tracking_lookup'],
    ['user', 'app.current_user'],
  ] as const)('%s transaction context', (kind, guc) => {
    async function run(fn: (tx: unknown) => Promise<unknown>) {
      const rls = await import('@/lib/db/rls');
      if (kind === 'security') return rls.withSecurityContext(fn);
      if (kind === 'lookup') return rls.withAuthLookupContext(fn);
      if (kind === 'tracking lookup') return rls.withTrackingLookupContext(fn);
      return rls.withUserContext('user-123', fn);
    }

    it('sets transaction-local context before invoking the callback', async () => {
      const { db } = await import('@/drizzle/db');
      const { PgDialect } = await import('drizzle-orm/pg-core');
      const execute = vi.fn().mockResolvedValue({ rows: [] });
      const tx = { execute };
      vi.mocked(db.transaction).mockImplementationOnce(async (fn) =>
        fn(tx as unknown as Parameters<typeof fn>[0]));
      const callback = vi.fn(async (client) => {
        expect(client).toBe(tx);
        expect(execute).toHaveBeenCalledTimes(1);
        const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
        expect(query.sql).toContain(guc);
        expect(query.sql).toContain('true)');
        return 'complete';
      });
      await expect(run(callback)).resolves.toBe('complete');
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('never runs the callback when context initialization fails', async () => {
      const { db } = await import('@/drizzle/db');
      const tx = { execute: vi.fn().mockRejectedValue(new Error('context failed')) };
      vi.mocked(db.transaction).mockImplementationOnce(async (fn) =>
        fn(tx as unknown as Parameters<typeof fn>[0]));
      const callback = vi.fn();
      await expect(run(callback)).rejects.toThrow('context failed');
      expect(callback).not.toHaveBeenCalled();
    });

    it('propagates callback failures to the transaction', async () => {
      const callback = vi.fn().mockRejectedValue(new Error('write failed'));
      await expect(run(callback)).rejects.toThrow('write failed');
    });
  });

  describe('combined contexts (#87)', () => {
    it('resolves an identity from a token with ONE statement, carrying both privileges', async () => {
      const { db } = await import('@/drizzle/db');
      const { PgDialect } = await import('drizzle-orm/pg-core');
      const execute = vi.fn().mockResolvedValue({ rows: [] });
      vi.mocked(db.transaction).mockImplementationOnce(async (fn) =>
        fn({ execute } as unknown as Parameters<typeof fn>[0]));

      const { withAuthResolutionContext } = await import('@/lib/db/rls');
      await withAuthResolutionContext('user-123', async () => 'done');

      // Two set_config statements used to mean two ~200 ms round-trips on every
      // session redemption, so the count itself is the thing under test.
      expect(execute).toHaveBeenCalledTimes(1);
      const sql = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]).sql;
      expect(sql).toContain("set_config('app.current_user'");
      expect(sql).toContain("set_config('app.auth_lookup', 'true'");
      expect(sql.match(/set_config/g)).toHaveLength(2);
    });

    it('refuses to resolve an identity for an empty userId', async () => {
      const { setAuthResolutionContext } = await import('@/lib/db/rls');
      await expect(setAuthResolutionContext('')).rejects.toThrow('empty userId');
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('applies the impersonation context as ONE transaction-local statement', async () => {
      const { db } = await import('@/drizzle/db');
      const { PgDialect } = await import('drizzle-orm/pg-core');
      const execute = vi.fn().mockResolvedValue({ rows: [] });
      vi.mocked(db.transaction).mockImplementationOnce(async (fn) =>
        fn({ execute } as unknown as Parameters<typeof fn>[0]));

      const { setImpersonationContext } = await import('@/lib/db/rls');
      await db.transaction(async (tx) => await setImpersonationContext('tenant-1', 'user-1', tx));

      expect(execute).toHaveBeenCalledTimes(1);
      const sql = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]).sql;
      expect(sql).toContain("set_config('app.is_super_admin', 'true'");
      expect(sql).toContain("set_config('app.current_tenant'");
      expect(sql).toContain("set_config('app.current_user'");
      // `tx` is required precisely so this can never be session-scoped.
      expect(sql).not.toContain('false)');
    });

    it('refuses an impersonation context with no workspace or no actor', async () => {
      const { setImpersonationContext } = await import('@/lib/db/rls');
      const tx = { execute: vi.fn() };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(setImpersonationContext('', 'user-1', tx as any)).rejects.toThrow('empty tenantId or userId');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(setImpersonationContext('tenant-1', '', tx as any)).rejects.toThrow('empty tenantId or userId');
      expect(tx.execute).not.toHaveBeenCalled();
    });
  });

  describe('verifyRLSEnabled', () => {
    it('returns true when RLS is enabled', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [{ rowsecurity: true }] });
      const { verifyRLSEnabled } = await import('@/lib/db/rls');
      const result = await verifyRLSEnabled('contacts');
      expect(result).toBe(true);
    });

    it('returns false when RLS is not enabled', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [{ rowsecurity: false }] });
      const { verifyRLSEnabled } = await import('@/lib/db/rls');
      const result = await verifyRLSEnabled('contacts');
      expect(result).toBe(false);
    });

    it('returns false on error', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB error'));
      const { verifyRLSEnabled } = await import('@/lib/db/rls');
      const result = await verifyRLSEnabled('contacts');
      expect(result).toBe(false);
    });
  });

  describe('verifyAllRLSEnabled', () => {
    it('checks all critical tables', async () => {
      mockExecute.mockResolvedValue({ rows: [{ rowsecurity: true }] });
      const { verifyAllRLSEnabled } = await import('@/lib/db/rls');
      const results = await verifyAllRLSEnabled();
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('table');
      expect(results[0]).toHaveProperty('enabled');
    });
  });

  // #2446 — the portal-credential lookup context. `portalLookupSettings` is the
  // whole grant surface of migration 0122, so its rules are tested here rather
  // than inferred from the SQL: an arm that can be opened with nothing, or with
  // an email alone, is a cross-tenant read waiting to happen.
  describe('portalLookupSettings', () => {
    const TOKEN_GUC = 'app.portal_lookup_token';
    const TENANT_GUC = 'app.portal_lookup_tenant';
    const EMAIL_GUC = 'app.portal_lookup_email';

    async function settings(claims: Record<string, string>) {
      const { portalLookupSettings } = await import('@/lib/db/portal-lookup-context');
      return portalLookupSettings(claims);
    }

    it('turns a presented access token into exactly its own GUC', async () => {
      expect(await settings({ accessToken: '  tok-1  ' })).toEqual([{ guc: TOKEN_GUC, value: 'tok-1' }]);
    });

    it('accepts a workspace on its own, which is what login probes the config with', async () => {
      expect(await settings({ tenantId: 'tenant-1' })).toEqual([{ guc: TENANT_GUC, value: 'tenant-1' }]);
    });

    it('pairs email with its tenant, because that is the arm 0122 matches on', async () => {
      expect(await settings({ tenantId: 'tenant-1', email: 'a@example.test' })).toEqual([
        { guc: TENANT_GUC, value: 'tenant-1' },
        { guc: EMAIL_GUC, value: 'a@example.test' },
      ]);
    });

    it('refuses an email with no tenant — an unscoped address lookup', async () => {
      const { portalLookupSettings } = await import('@/lib/db/portal-lookup-context');
      expect(() => portalLookupSettings({ email: 'a@example.test' })).toThrow(/email without a tenantId/);
    });

    it('refuses an empty credential set rather than opening a bare lookup', async () => {
      const { portalLookupSettings } = await import('@/lib/db/portal-lookup-context');
      expect(() => portalLookupSettings({})).toThrow(/no credential/);
      expect(() => portalLookupSettings({ accessToken: '   ', tenantId: '' })).toThrow(/no credential/);
    });

    it('refuses a value no real credential is as long as', async () => {
      const { portalLookupSettings } = await import('@/lib/db/portal-lookup-context');
      // A 1 MB token would make the policy compare one string against every row.
      expect(() => portalLookupSettings({ accessToken: 'x'.repeat(513) })).toThrow(/longer than 512/);
      expect(() => portalLookupSettings({ tenantId: 'tenant-1', email: `e${'x'.repeat(600)}@example.test` })).toThrow(/longer than 512/);
      expect(portalLookupSettings({ accessToken: 'x'.repeat(512) })).toHaveLength(1);
    });
  });

  describe('withPortalLookupContext', () => {
    it('sets every requested privilege with ONE transaction-local statement (#87)', async () => {
      const { db } = await import('@/drizzle/db');
      const { PgDialect } = await import('drizzle-orm/pg-core');
      const execute = vi.fn().mockResolvedValue({ rows: [] });
      const tx = { execute };
      vi.mocked(db.transaction).mockImplementationOnce(async (fn) =>
        fn(tx as unknown as Parameters<typeof fn>[0]));

      const { withPortalLookupContext } = await import('@/lib/db/portal-lookup-context');
      const callback = vi.fn(async (client) => {
        // The callback gets the transaction it was opened on, never the pool:
        // a bare `db.*` inside would lose the GUC the statement just set.
        expect(client).toBe(tx);
        return 'complete';
      });
      const result = await withPortalLookupContext(
        { accessToken: 'tok-1', tenantId: 'tenant-1', email: 'a@example.test' },
        callback,
      );

      expect(result).toBe('complete');
      // PP-028: three separate set_config calls are three ~200 ms round-trips on
      // every portal request, so the count is the thing under test.
      expect(execute).toHaveBeenCalledTimes(1);
      expect(mockExecute).not.toHaveBeenCalled();
      const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
      expect(query.sql.match(/set_config/g)).toHaveLength(3);
      // Transaction-local: never `false`, which would outlive the checkout.
      expect(query.sql).not.toContain('false)');
      expect(query.sql).toContain('true)');
      // Names AND values are bound, never concatenated into the statement text:
      // a credential is caller-controlled input.
      expect(query.params).toEqual([
        'app.portal_lookup_token', 'tok-1',
        'app.portal_lookup_tenant', 'tenant-1',
        'app.portal_lookup_email', 'a@example.test',
      ]);
      expect(query.sql).not.toContain('tok-1');
    });

    it('never runs the callback when the privilege cannot be set', async () => {
      const { db } = await import('@/drizzle/db');
      const tx = { execute: vi.fn().mockRejectedValue(new Error('context failed')) };
      vi.mocked(db.transaction).mockImplementationOnce(async (fn) =>
        fn(tx as unknown as Parameters<typeof fn>[0]));

      const { withPortalLookupContext } = await import('@/lib/db/portal-lookup-context');
      const callback = vi.fn();
      await expect(
        withPortalLookupContext({ accessToken: 'tok-1' }, callback),
      ).rejects.toThrow('context failed');
      expect(callback).not.toHaveBeenCalled();
    });

    it('refuses an unscoped lookup before touching the database', async () => {
      const { db } = await import('@/drizzle/db');
      const { withPortalLookupContext } = await import('@/lib/db/portal-lookup-context');
      await expect(
        withPortalLookupContext({ email: 'a@example.test' }, vi.fn()),
      ).rejects.toThrow(/email without a tenantId/);
      expect(db.transaction).not.toHaveBeenCalled();
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });
});
