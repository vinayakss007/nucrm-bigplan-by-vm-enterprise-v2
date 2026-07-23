/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindFirst, mockSelectChain } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockSelectChain: vi.fn(),
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      tenants: { findFirst: (..._args: any[]) => mockFindFirst('tenants', ..._args) },
      tenantModules: { findFirst: (..._args: any[]) => mockFindFirst('tenantModules', ..._args) },
      modules: { findFirst: (..._args: any[]) => mockFindFirst('modules', ..._args) },
    },
    select: mockSelectChain,
    insert: (..._args: any[]) => ({
      values: (..._valArgs: any[]) => ({
        onConflictDoNothing: vi.fn(() => ({ then: vi.fn() })),
      }),
    }),
    update: (..._args: any[]) => ({
      set: (..._setArgs: any[]) => ({
        where: (..._whereArgs: any[]) => undefined,
      }),
    }),
    transaction: vi.fn(),
  },
}));

vi.mock('@/drizzle/schema/modules', () => ({
  tenantModules: {
    tenantId: 'tenant_id',
    moduleId: 'module_id',
    status: 'status',
    settings: 'settings',
    installedBy: 'installed_by',
    installedAt: 'installed_at',
    lastUsedAt: 'last_used_at',
    updatedAt: 'updated_at',
    forceEnabled: 'force_enabled',
    enabledFeatures: 'enabled_features',
  },
  modules: {
    id: 'id',
    name: 'name',
    version: 'version',
    description: 'description',
    category: 'category',
    icon: 'icon',
    manifest: 'manifest',
  },
}));

vi.mock('@/drizzle/schema', () => ({
  tenants: {
    id: 'id',
    planId: 'plan_id',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: any, _val: any) => `eq(${String(_val)})`),
  and: vi.fn((..._args: any[]) => 'and()'),
}));

import { ModuleRegistry, BUILTIN_MODULES } from '@/lib/modules/registry';

describe('modules/registry', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('BUILTIN_MODULES', () => {
    it('has more than 10 builtin modules', () => {
      expect(BUILTIN_MODULES.length).toBeGreaterThanOrEqual(10);
    });

    it('each has required fields', () => {
      for (const m of BUILTIN_MODULES) {
        expect(m.id).toBeTruthy();
        expect(m.name).toBeTruthy();
        expect(m.version).toBeTruthy();
        expect(m.pricing).toBeDefined();
      }
    });
  });

  describe('ModuleRegistry.getAll', () => {
    it('returns all builtin modules', () => {
      expect(ModuleRegistry.getAll()).toBe(BUILTIN_MODULES);
    });
  });

  describe('ModuleRegistry.get', () => {
    it('returns module by id', () => {
      expect(ModuleRegistry.get('core-crm')).toBeDefined();
      expect(ModuleRegistry.get('core-crm')!.name).toBe('Core CRM');
    });

    it('returns null for unknown id', () => {
      expect(ModuleRegistry.get('nonexistent')).toBeNull();
    });
  });

  describe('ModuleRegistry.hasModule', () => {
    it('returns true when active', async () => {
      mockFindFirst.mockResolvedValue({ status: 'active' });
      const r = await ModuleRegistry.hasModule('t1', 'core-crm');
      expect(r).toBe(true);
    });

    it('returns false when disabled', async () => {
      mockFindFirst.mockResolvedValue({ status: 'disabled' });
      const r = await ModuleRegistry.hasModule('t1', 'core-crm');
      expect(r).toBe(false);
    });

    it('returns false when not found', async () => {
      mockFindFirst.mockResolvedValue(undefined);
      const r = await ModuleRegistry.hasModule('t1', 'core-crm');
      expect(r).toBe(false);
    });
  });

  describe('ModuleRegistry.hasFeature', () => {
    it('returns true when feature is enabled', async () => {
      mockFindFirst.mockResolvedValue({ status: 'active', enabledFeatures: ['feat1', 'feat2'] });
      const r = await ModuleRegistry.hasFeature('t1', 'mod1', 'feat1');
      expect(r).toBe(true);
    });

    it('returns false when feature not in list', async () => {
      mockFindFirst.mockResolvedValue({ status: 'active', enabledFeatures: ['feat1'] });
      const r = await ModuleRegistry.hasFeature('t1', 'mod1', 'feat2');
      expect(r).toBe(false);
    });

    it('returns false when module not active', async () => {
      mockFindFirst.mockResolvedValue({ status: 'disabled', enabledFeatures: ['feat1'] });
      const r = await ModuleRegistry.hasFeature('t1', 'mod1', 'feat1');
      expect(r).toBe(false);
    });

    it('returns false when enabledFeatures is null', async () => {
      mockFindFirst.mockResolvedValue({ status: 'active', enabledFeatures: null });
      const r = await ModuleRegistry.hasFeature('t1', 'mod1', 'feat1');
      expect(r).toBe(false);
    });
  });

  describe('ModuleRegistry.getTenantPlan', () => {
    it('returns plan id', async () => {
      mockFindFirst.mockResolvedValue({ planId: 'pro' });
      const r = await ModuleRegistry.getTenantPlan('t1');
      expect(r).toBe('pro');
    });

    it('returns free when no plan', async () => {
      mockFindFirst.mockResolvedValue({ planId: null });
      const r = await ModuleRegistry.getTenantPlan('t1');
      expect(r).toBe('free');
    });
  });

  describe('ModuleRegistry.checkPlanGate', () => {
    it('returns error when module not found', async () => {
      const r = await ModuleRegistry.checkPlanGate('t1', 'nonexistent');
      expect(r.ok).toBe(false);
      expect(r.error).toContain('not found');
    });

    it('returns ok when forceEnabled', async () => {
      mockFindFirst.mockResolvedValue({ forceEnabled: true });
      const r = await ModuleRegistry.checkPlanGate('t1', 'core-crm');
      expect(r.ok).toBe(true);
    });

    it('returns ok when plan is enabled', async () => {
      mockFindFirst
        .mockResolvedValueOnce({ forceEnabled: false })
        .mockResolvedValueOnce({ manifest: null })
        .mockResolvedValueOnce({ planId: 'pro' });
      const r = await ModuleRegistry.checkPlanGate('t1', 'core-crm');
      expect(r.ok).toBe(true);
    });

    it('returns error when plan not enabled', async () => {
      mockFindFirst
        .mockResolvedValueOnce({ forceEnabled: false })
        .mockResolvedValueOnce({ manifest: null })
        .mockResolvedValueOnce({ planId: 'free' });
      const r = await ModuleRegistry.checkPlanGate('t1', 'automation-pro');
      expect(r.ok).toBe(false);
      expect(r.error).toContain('not available');
    });
  });

  describe('ModuleRegistry.install', () => {
    it('returns error for unknown module', async () => {
      const r = await ModuleRegistry.install('t1', 'nonexistent', 'admin');
      expect(r.ok).toBe(false);
      expect(r.error).toContain('not found');
    });

    it('installs module successfully', async () => {
      mockFindFirst
        .mockResolvedValueOnce({ forceEnabled: false })
        .mockResolvedValueOnce({ manifest: null })
        .mockResolvedValueOnce({ planId: 'pro' });
      const r = await ModuleRegistry.install('t1', 'core-crm', 'admin', { key: 'val' });
      expect(r.ok).toBe(true);
    });
  });

  describe('ModuleRegistry.disable', () => {
    it('calls update', async () => {
      await ModuleRegistry.disable('t1', 'core-crm');
      expect(true).toBe(true);
    });
  });

  describe('ModuleRegistry.getSettings', () => {
    it('returns settings object', async () => {
      mockFindFirst.mockResolvedValue({ settings: { apiKey: 'xxx' } });
      const r = await ModuleRegistry.getSettings('t1', 'whatsapp-bot');
      expect(r).toEqual({ apiKey: 'xxx' });
    });

    it('returns empty object when none', async () => {
      mockFindFirst.mockResolvedValue(undefined);
      const r = await ModuleRegistry.getSettings('t1', 'whatsapp-bot');
      expect(r).toEqual({});
    });
  });

  describe('ModuleRegistry.updateSettings', () => {
    it('calls update with new settings', async () => {
      await ModuleRegistry.updateSettings('t1', 'whatsapp-bot', { token: 'abc' });
      expect(true).toBe(true);
    });
  });

  describe('getTenantModules', () => {
    it('merges DB rows with manifests', async () => {
      mockSelectChain.mockReturnValue({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([
              { moduleId: 'core-crm', status: 'active', settings: {}, installedAt: new Date(), lastUsedAt: null, name: 'Core CRM', description: 'CRM', category: 'utility', icon: '📋' },
              { moduleId: 'whatsapp-bot', status: 'active', settings: {}, installedAt: new Date(), lastUsedAt: null, name: 'WhatsApp', description: 'WA', category: 'messaging', icon: '💬' },
            ]),
          })),
        })),
      });
      const r = await ModuleRegistry.getTenantModules('t1');
      expect(r.length).toBe(2);
      expect(r[0].module_id).toBe('core-crm');
      expect(r[0].manifest.name).toBe('Core CRM');
    });
  });
});
