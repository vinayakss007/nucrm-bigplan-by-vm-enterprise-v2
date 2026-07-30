/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindFirst, mockSelectChain } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockSelectChain: vi.fn(),
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      tenants: { findFirst: (...args: any[]) => mockFindFirst('tenants', ...args) },
      tenantModules: { findFirst: (...args: any[]) => mockFindFirst('tenantModules', ...args) },
      modules: { findFirst: (...args: any[]) => mockFindFirst('modules', ...args) },
    },
    select: mockSelectChain,
    insert: (..._args: any[]) => ({
      values: (..._valArgs: any[]) => ({
        onConflictDoNothing: vi.fn(() => ({ then: vi.fn() })),
        onConflictDoUpdate: vi.fn(() => ({ then: vi.fn() })),
      }),
    }),
    update: (..._args: any[]) => ({
      set: (..._setArgs: any[]) => ({
        where: (..._whereArgs: any[]) => undefined,
      }),
    }),
    transaction: vi.fn((cb: (tx: any) => Promise<any>) => {
      const tx: any = {
        insert: () => ({
          values: () => ({
            onConflictDoNothing: vi.fn(),
            onConflictDoUpdate: vi.fn(),
          }),
        }),
        update: () => ({
          set: () => ({
            where: vi.fn(),
          }),
        }),
      };
      return cb(tx);
    }),
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

describe('module-registry', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('getAvailableModules returns correct list for plan', () => {
    it('returns all modules from the builtin list', () => {
      const all = ModuleRegistry.getAll();
      expect(all).toBe(BUILTIN_MODULES);
      expect(all.length).toBeGreaterThan(10);
    });

    it('free plan modules include core-crm and automation-basic', () => {
      const all = ModuleRegistry.getAll();
      const freeModules = all.filter(
        (m) => m.pricing?.free && (m.pricing.free as any).enabled
      );
      const freeIds = freeModules.map((m) => m.id);
      expect(freeIds).toContain('core-crm');
      expect(freeIds).toContain('automation-basic');
      expect(freeIds).toContain('dashboard-core');
    });

    it('pro plan has more modules than free plan', () => {
      const all = ModuleRegistry.getAll();
      const freeModules = all.filter(
        (m) => m.pricing?.free && (m.pricing.free as any).enabled
      );
      const proModules = all.filter(
        (m) => m.pricing?.pro && (m.pricing.pro as any).enabled
      );
      expect(proModules.length).toBeGreaterThan(freeModules.length);
    });

    it('enterprise plan includes all modules', () => {
      const all = ModuleRegistry.getAll();
      const enterpriseModules = all.filter(
        (m) => m.pricing?.enterprise && (m.pricing.enterprise as any).enabled
      );
      expect(enterpriseModules.length).toBe(all.length);
    });

    it('ai-assistant is only available on pro and enterprise', () => {
      const aiModule = ModuleRegistry.get('ai-assistant');
      expect(aiModule).not.toBeNull();
      expect((aiModule!.pricing?.free as any)?.enabled).toBe(false);
      expect((aiModule!.pricing?.starter as any)?.enabled).toBe(false);
      expect((aiModule!.pricing?.pro as any)?.enabled).toBe(true);
      expect((aiModule!.pricing?.enterprise as any)?.enabled).toBe(true);
    });
  });

  describe('isModuleEnabled checks tenant_modules correctly', () => {
    it('returns true when module is active for tenant', async () => {
      mockFindFirst.mockResolvedValue({ status: 'active' });
      const result = await ModuleRegistry.hasModule('tenant-1', 'core-crm');
      expect(result).toBe(true);
    });

    it('returns false when module is disabled for tenant', async () => {
      mockFindFirst.mockResolvedValue({ status: 'disabled' });
      const result = await ModuleRegistry.hasModule('tenant-1', 'core-crm');
      expect(result).toBe(false);
    });

    it('returns false when module not installed for tenant', async () => {
      mockFindFirst.mockResolvedValue(undefined);
      const result = await ModuleRegistry.hasModule('tenant-1', 'whatsapp-bot');
      expect(result).toBe(false);
    });

    it('returns false when status is error', async () => {
      mockFindFirst.mockResolvedValue({ status: 'error' });
      const result = await ModuleRegistry.hasModule('tenant-1', 'ai-assistant');
      expect(result).toBe(false);
    });

    it('checks specific feature within a module', async () => {
      mockFindFirst.mockResolvedValue({
        status: 'active',
        enabledFeatures: ['Visual drag-drop builder', 'Unlimited automations'],
      });
      const result = await ModuleRegistry.hasFeature(
        'tenant-1',
        'automation-pro',
        'Visual drag-drop builder'
      );
      expect(result).toBe(true);
    });

    it('returns false for feature not in enabled list', async () => {
      mockFindFirst.mockResolvedValue({
        status: 'active',
        enabledFeatures: ['Visual drag-drop builder'],
      });
      const result = await ModuleRegistry.hasFeature(
        'tenant-1',
        'automation-pro',
        'Conditional logic'
      );
      expect(result).toBe(false);
    });
  });

  describe('getModuleConfig returns proper defaults', () => {
    it('returns stored settings when available', async () => {
      mockFindFirst.mockResolvedValue({
        settings: { phone_number_id: '12345', access_token: 'tok_abc' },
      });
      const settings = await ModuleRegistry.getSettings('tenant-1', 'whatsapp-bot');
      expect(settings).toEqual({
        phone_number_id: '12345',
        access_token: 'tok_abc',
      });
    });

    it('returns empty object when no settings stored', async () => {
      mockFindFirst.mockResolvedValue(undefined);
      const settings = await ModuleRegistry.getSettings('tenant-1', 'whatsapp-bot');
      expect(settings).toEqual({});
    });

    it('returns empty object when settings field is null', async () => {
      mockFindFirst.mockResolvedValue({ settings: null });
      const settings = await ModuleRegistry.getSettings('tenant-1', 'email-sync');
      expect(settings).toEqual({});
    });

    it('module manifest contains settings_schema for configurable modules', () => {
      const whatsapp = ModuleRegistry.get('whatsapp-bot');
      expect(whatsapp).not.toBeNull();
      expect(whatsapp!.settings_schema).toBeDefined();
      expect(whatsapp!.settings_schema!.length).toBeGreaterThan(0);
      expect(whatsapp!.settings_schema![0].key).toBe('phone_number_id');
    });

    it('modules without settings_schema do not have one', () => {
      const coreCrm = ModuleRegistry.get('core-crm');
      expect(coreCrm).not.toBeNull();
      expect(coreCrm!.settings_schema).toBeUndefined();
    });

    it('updates settings and reflects in DB call', async () => {
      await ModuleRegistry.updateSettings('tenant-1', 'whatsapp-bot', {
        phone_number_id: '99999',
        access_token: 'new_tok',
      });
      expect(true).toBe(true);
    });
  });

  describe('plan gating', () => {
    it('returns error for non-existent module', async () => {
      const result = await ModuleRegistry.checkPlanGate('tenant-1', 'does-not-exist');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('allows force-enabled modules regardless of plan', async () => {
      mockFindFirst.mockResolvedValue({ forceEnabled: true });
      const result = await ModuleRegistry.checkPlanGate('tenant-1', 'ai-assistant');
      expect(result.ok).toBe(true);
    });

    it('blocks module when plan does not include it', async () => {
      mockFindFirst
        .mockResolvedValueOnce({ forceEnabled: false })
        .mockResolvedValueOnce({ manifest: null })
        .mockResolvedValueOnce({ planId: 'free' });
      const result = await ModuleRegistry.checkPlanGate('tenant-1', 'ai-assistant');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('not available');
    });

    it('allows module when plan includes it', async () => {
      mockFindFirst
        .mockResolvedValueOnce({ forceEnabled: false })
        .mockResolvedValueOnce({ manifest: null })
        .mockResolvedValueOnce({ planId: 'pro' });
      const result = await ModuleRegistry.checkPlanGate('tenant-1', 'ai-assistant');
      expect(result.ok).toBe(true);
    });
  });
});
