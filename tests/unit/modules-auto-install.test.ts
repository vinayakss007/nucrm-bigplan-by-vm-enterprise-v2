import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(),
      })),
    })),
  },
}));

vi.mock('@/drizzle/schema/modules', () => ({
  modules: { _table: 'modules' },
  tenantModules: { _table: 'tenantModules' },
}));

vi.mock('@/lib/modules/registry', () => ({
  BUILTIN_MODULES: [
    { id: 'core-crm', name: 'Core CRM', version: '1.0.0', description: 'Core CRM module', category: 'utility', icon: '📋' },
    { id: 'automation-basic', name: 'Basic Automation', version: '1.0.0', description: 'Basic automation', category: 'automation', icon: '⚡' },
    { id: 'automation-pro', name: 'Automation Pro', version: '1.0.0', description: 'Pro automation', category: 'automation', icon: '🚀' },
    { id: 'ai-assistant', name: 'AI Assistant', version: '1.0.0', description: 'AI assistant' },
    { id: 'forms-builder', name: 'Forms Builder', version: '1.0.0' },
  ],
}));

vi.mock('@/lib/modules/industry-templates', () => ({
  INDUSTRY_TEMPLATES: {
    real_estate: {
      id: 'real_estate',
      name: 'Real Estate',
      description: 'Real estate CRM template',
      icon: '🏠',
      modules: ['core-crm', 'automation-basic', 'forms-builder', 'ghost-module'],
      custom_fields: [],
      pipelines: [],
      automations: [],
    },
    saas: {
      id: 'saas',
      name: 'SaaS / Software',
      description: 'SaaS CRM template',
      icon: '💻',
      modules: ['core-crm', 'automation-pro', 'ai-assistant', 'analytics-pro'],
      custom_fields: [],
      pipelines: [],
      automations: [],
    },
  },
}));

// auto-install now logs failures via the structured logger (not console.error).
const mockLoggerError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', () => ({
  logger: { error: mockLoggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe('auto-install', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = await import('@/drizzle/db');
    (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(),
      })),
    }));
  });

  describe('getDefaultModulesForPlan', () => {
    it('returns core-crm and automation-basic for free plan', async () => {
      const { getDefaultModulesForPlan } = await import('@/lib/modules/auto-install');
      expect(getDefaultModulesForPlan('free')).toEqual(['core-crm', 'automation-basic']);
    });

    it('returns starter plan modules', async () => {
      const { getDefaultModulesForPlan } = await import('@/lib/modules/auto-install');
      const modules = getDefaultModulesForPlan('starter');
      expect(modules).toContain('core-crm');
      expect(modules).toContain('automation-pro');
      expect(modules).toContain('service-helpdesk');
      expect(modules).toContain('email-sync');
      expect(modules.length).toBe(8);
    });

    it('returns pro plan modules including ai-assistant', async () => {
      const { getDefaultModulesForPlan } = await import('@/lib/modules/auto-install');
      const modules = getDefaultModulesForPlan('pro');
      expect(modules).toContain('ai-assistant');
      expect(modules).toContain('analytics-pro');
      expect(modules).toContain('calculated-fields');
      expect(modules).toContain('forms-builder');
      expect(modules.length).toBe(12);
    });

    it('returns enterprise plan modules including industry-templates', async () => {
      const { getDefaultModulesForPlan } = await import('@/lib/modules/auto-install');
      const modules = getDefaultModulesForPlan('enterprise');
      expect(modules).toContain('industry-templates');
      expect(modules).toContain('analytics-pro');
      expect(modules.length).toBe(13);
    });

    it('falls back to free modules for unknown plan id', async () => {
      const { getDefaultModulesForPlan } = await import('@/lib/modules/auto-install');
      expect(getDefaultModulesForPlan('nonexistent')).toEqual(['core-crm', 'automation-basic']);
    });
  });

  describe('getModulesForPlanAndTemplate', () => {
    it('returns plan modules when no templateId given', async () => {
      const { getModulesForPlanAndTemplate, getDefaultModulesForPlan } = await import('@/lib/modules/auto-install');
      expect(getModulesForPlanAndTemplate('free')).toEqual(getDefaultModulesForPlan('free'));
    });

    it('merges plan and template modules without duplicates', async () => {
      const { getModulesForPlanAndTemplate } = await import('@/lib/modules/auto-install');
      const result = getModulesForPlanAndTemplate('free', 'saas');
      expect(result).toContain('core-crm');
      expect(result).toContain('automation-basic');
      expect(result).toContain('automation-pro');
      expect(result).toContain('ai-assistant');
      expect(result).toContain('analytics-pro');
      expect(new Set(result).size).toBe(result.length);
      expect(result.length).toBe(5);
    });

    it('returns only plan modules for an invalid template id', async () => {
      const { getModulesForPlanAndTemplate, getDefaultModulesForPlan } = await import('@/lib/modules/auto-install');
      expect(getModulesForPlanAndTemplate('starter', 'nonexistent')).toEqual(getDefaultModulesForPlan('starter'));
    });

    it('returns only plan modules when templateId is undefined', async () => {
      const { getModulesForPlanAndTemplate, getDefaultModulesForPlan } = await import('@/lib/modules/auto-install');
      expect(getModulesForPlanAndTemplate('pro', undefined)).toEqual(getDefaultModulesForPlan('pro'));
    });

    it('deduplicates overlapping modules between plan and template', async () => {
      const { getModulesForPlanAndTemplate } = await import('@/lib/modules/auto-install');
      const result = getModulesForPlanAndTemplate('free', 'real_estate');
      const counts: Record<string, number> = {};
      for (const m of result) counts[m] = (counts[m] ?? 0) + 1;
      for (const count of Object.values(counts)) expect(count).toBe(1);
    });
  });

  describe('getTemplateModules', () => {
    it('returns valid modules for a known template filtering out unknowns', async () => {
      const { getTemplateModules } = await import('@/lib/modules/auto-install');
      const result = getTemplateModules('real_estate');
      expect(result).toContain('core-crm');
      expect(result).toContain('automation-basic');
      expect(result).toContain('forms-builder');
      expect(result).not.toContain('ghost-module');
      expect(result.length).toBe(3);
    });

    it('returns empty array for unknown template id', async () => {
      const { getTemplateModules } = await import('@/lib/modules/auto-install');
      expect(getTemplateModules('nonexistent')).toEqual([]);
    });

    it('returns empty array for empty string template id', async () => {
      const { getTemplateModules } = await import('@/lib/modules/auto-install');
      expect(getTemplateModules('')).toEqual([]);
    });

    it('only includes modules present in BUILTIN_MODULES', async () => {
      const { getTemplateModules } = await import('@/lib/modules/auto-install');
      const { BUILTIN_MODULES } = await import('@/lib/modules/registry');
      const validIds = new Set(BUILTIN_MODULES.map((m: { id: string }) => m.id));
      const result = getTemplateModules('saas');
      expect(result).toContain('core-crm');
      expect(result).toContain('automation-pro');
      expect(result).toContain('ai-assistant');
      expect(result).not.toContain('analytics-pro');
      for (const modId of result) expect(validIds.has(modId)).toBe(true);
    });
  });

  describe('installTemplateModules', () => {
    it('inserts each valid template module into both tables for the tenant', async () => {
      const { modules: mTable, tenantModules: tmTable } = await import('@/drizzle/schema/modules');
      const { db } = await import('@/drizzle/db');
      const { installTemplateModules } = await import('@/lib/modules/auto-install');

      await installTemplateModules('tenant-1', 'real_estate');

      expect(db.insert).toHaveBeenCalledTimes(6);
      expect(db.insert).toHaveBeenNthCalledWith(1, mTable);
      expect(db.insert).toHaveBeenNthCalledWith(2, tmTable);
      expect(db.insert).toHaveBeenNthCalledWith(3, mTable);
      expect(db.insert).toHaveBeenNthCalledWith(4, tmTable);
      expect(db.insert).toHaveBeenNthCalledWith(5, mTable);
      expect(db.insert).toHaveBeenNthCalledWith(6, tmTable);
    });

    it('passes correct values to the modules insert', async () => {
      const { db } = await import('@/drizzle/db');
      const { installTemplateModules } = await import('@/lib/modules/auto-install');

      const captured: unknown[] = [];
      (db.insert as ReturnType<typeof vi.fn>).mockImplementation((table: unknown) => ({
        values: vi.fn((data: unknown) => {
          captured.push({ table, data });
          return { onConflictDoNothing: vi.fn() };
        }),
      }));

      await installTemplateModules('tenant-1', 'real_estate');

      const coreCrmInsert = captured[0] as { table: unknown; data: Record<string, unknown> };
      expect(coreCrmInsert.data).toMatchObject({
        id: 'core-crm',
        name: 'Core CRM',
        version: '1.0.0',
        description: 'Core CRM module',
        category: 'utility',
        icon: '📋',
        manifest: expect.objectContaining({ id: 'core-crm' }),
      });

      const coreCrmTmInsert = captured[1] as { data: Record<string, unknown> };
      expect(coreCrmTmInsert.data).toMatchObject({
        tenantId: 'tenant-1',
        moduleId: 'core-crm',
        status: 'active',
        enabledFeatures: [],
        settings: {},
      });
    });

    it('skips ghost-module that is not in BUILTIN_MODULES', async () => {
      const { modules: mTable } = await import('@/drizzle/schema/modules');
      const { db } = await import('@/drizzle/db');
      const { installTemplateModules } = await import('@/lib/modules/auto-install');

      const captured: unknown[] = [];
      (db.insert as ReturnType<typeof vi.fn>).mockImplementation((table: unknown) => ({
        values: vi.fn((data: unknown) => {
          captured.push({ table, data });
          return { onConflictDoNothing: vi.fn() };
        }),
      }));

      await installTemplateModules('tenant-1', 'real_estate');

      const moduleInserts = captured.filter(
        (c: unknown) => (c as { table: unknown }).table === mTable,
      ) as Array<{ data: Record<string, unknown> }>;
      const insertedIds = moduleInserts.map(c => c.data.id);
      expect(insertedIds).toContain('core-crm');
      expect(insertedIds).toContain('automation-basic');
      expect(insertedIds).toContain('forms-builder');
      expect(insertedIds).not.toContain('ghost-module');
    });

    it('is a no-op when template does not exist', async () => {
      const { db } = await import('@/drizzle/db');
      const { installTemplateModules } = await import('@/lib/modules/auto-install');

      await installTemplateModules('tenant-1', 'nonexistent');

      expect(db.insert).not.toHaveBeenCalled();
    });

    it('logs error to console.error and does not throw when db fails', async () => {
      const { db } = await import('@/drizzle/db');
      const { installTemplateModules } = await import('@/lib/modules/auto-install');

      const error = new Error('Connection refused');
      (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn().mockRejectedValue(error),
        })),
      }));

      await expect(installTemplateModules('tenant-1', 'real_estate')).resolves.toBeUndefined();
      expect(mockLoggerError).toHaveBeenCalledWith('[auto-install] Failed to install template modules', { error: error.message });
    });

    it('installs saas template modules (including analytics-pro that gets skipped)', async () => {
      const { modules: mTable } = await import('@/drizzle/schema/modules');
      const { db } = await import('@/drizzle/db');
      const { installTemplateModules } = await import('@/lib/modules/auto-install');

      const captured: unknown[] = [];
      (db.insert as ReturnType<typeof vi.fn>).mockImplementation((table: unknown) => ({
        values: vi.fn((data: unknown) => {
          captured.push({ table, data });
          return { onConflictDoNothing: vi.fn() };
        }),
      }));

      await installTemplateModules('tenant-1', 'saas');

      const moduleInserts = captured.filter(
        (c: unknown) => (c as { table: unknown }).table === mTable,
      ) as Array<{ data: Record<string, unknown> }>;
      const insertedIds = moduleInserts.map(c => c.data.id);
      expect(insertedIds).toContain('core-crm');
      expect(insertedIds).toContain('automation-pro');
      expect(insertedIds).toContain('ai-assistant');
      expect(insertedIds).not.toContain('analytics-pro');
      expect(insertedIds.length).toBe(3);
    });
  });

  describe('installDefaultModules', () => {
    it('inserts default plan modules for the tenant', async () => {
      const { modules: mTable, tenantModules: tmTable } = await import('@/drizzle/schema/modules');
      const { db } = await import('@/drizzle/db');
      const { installDefaultModules } = await import('@/lib/modules/auto-install');

      await installDefaultModules('tenant-1', 'free');

      expect(db.insert).toHaveBeenCalledTimes(4);
      expect(db.insert).toHaveBeenNthCalledWith(1, mTable);
      expect(db.insert).toHaveBeenNthCalledWith(2, tmTable);
      expect(db.insert).toHaveBeenNthCalledWith(3, mTable);
      expect(db.insert).toHaveBeenNthCalledWith(4, tmTable);
    });

    it('installs plan + template merged modules with deduplication', async () => {
      const { modules: mTable } = await import('@/drizzle/schema/modules');
      const { db } = await import('@/drizzle/db');
      const { installDefaultModules } = await import('@/lib/modules/auto-install');

      const captured: unknown[] = [];
      (db.insert as ReturnType<typeof vi.fn>).mockImplementation((table: unknown) => ({
        values: vi.fn((data: unknown) => {
          captured.push({ table, data });
          return { onConflictDoNothing: vi.fn() };
        }),
      }));

      await installDefaultModules('tenant-1', 'free', 'saas');

      const moduleInserts = captured.filter(
        (c: unknown) => (c as { table: unknown }).table === mTable,
      ) as Array<{ data: Record<string, unknown> }>;
      const ids = moduleInserts.map(c => c.data.id);
      expect(ids).toContain('core-crm');
      expect(ids).toContain('automation-basic');
      expect(ids).toContain('automation-pro');
      expect(ids).toContain('ai-assistant');
      expect(ids).not.toContain('analytics-pro');
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeGreaterThan(2);
    });

    it('skips ghost-module from template not in BUILTIN_MODULES', async () => {
      const { modules: mTable } = await import('@/drizzle/schema/modules');
      const { db } = await import('@/drizzle/db');
      const { installDefaultModules } = await import('@/lib/modules/auto-install');

      const captured: unknown[] = [];
      (db.insert as ReturnType<typeof vi.fn>).mockImplementation((table: unknown) => ({
        values: vi.fn((data: unknown) => {
          captured.push({ table, data });
          return { onConflictDoNothing: vi.fn() };
        }),
      }));

      await installDefaultModules('tenant-1', 'free', 'real_estate');

      const moduleInserts = captured.filter(
        (c: unknown) => (c as { table: unknown }).table === mTable,
      ) as Array<{ data: Record<string, unknown> }>;
      const insertedIds = moduleInserts.map(c => c.data.id);
      expect(insertedIds).toContain('core-crm');
      expect(insertedIds).toContain('automation-basic');
      expect(insertedIds).toContain('forms-builder');
      expect(insertedIds).not.toContain('ghost-module');
    });

    it('passes correct values to the db inserts', async () => {
      const { db } = await import('@/drizzle/db');
      const { installDefaultModules } = await import('@/lib/modules/auto-install');

      const captured: unknown[] = [];
      (db.insert as ReturnType<typeof vi.fn>).mockImplementation((table: unknown) => ({
        values: vi.fn((data: unknown) => {
          captured.push({ table, data });
          return { onConflictDoNothing: vi.fn() };
        }),
      }));

      await installDefaultModules('tenant-1', 'free');

      const firstInsert = captured[0] as { data: Record<string, unknown> };
      expect(firstInsert.data).toMatchObject({
        id: 'core-crm',
        name: 'Core CRM',
        version: '1.0.0',
        description: 'Core CRM module',
        category: 'utility',
        icon: '📋',
        manifest: expect.objectContaining({ id: 'core-crm' }),
      });

      const secondInsert = captured[1] as { data: Record<string, unknown> };
      expect(secondInsert.data).toMatchObject({
        tenantId: 'tenant-1',
        moduleId: 'core-crm',
        status: 'active',
        enabledFeatures: [],
        settings: {},
      });
    });

    it('converts undefined manifest fields to null', async () => {
      const { modules: mTable } = await import('@/drizzle/schema/modules');
      const { db } = await import('@/drizzle/db');
      const { installDefaultModules } = await import('@/lib/modules/auto-install');

      const captured: unknown[] = [];
      (db.insert as ReturnType<typeof vi.fn>).mockImplementation((table: unknown) => ({
        values: vi.fn((data: unknown) => {
          captured.push({ table, data });
          return { onConflictDoNothing: vi.fn() };
        }),
      }));

      await installDefaultModules('tenant-1', 'free', 'real_estate');

      const moduleInserts = captured.filter(
        (c: unknown) => (c as { table: unknown }).table === mTable,
      ) as Array<{ data: Record<string, unknown> }>;

      const aiAssistant = moduleInserts.find(c => c.data.id === 'ai-assistant');
      expect(aiAssistant).toBeUndefined();

      const formsBuilder = moduleInserts.find(c => c.data.id === 'forms-builder');
      expect(formsBuilder).toBeDefined();
      expect(formsBuilder!.data.description).toBeNull();
      expect(formsBuilder!.data.category).toBeNull();
      expect(formsBuilder!.data.icon).toBeNull();
    });

    it('logs error to console.error and does not throw when db insertion fails', async () => {
      const { db } = await import('@/drizzle/db');
      const { installDefaultModules } = await import('@/lib/modules/auto-install');

      const error = new Error('Deadlock detected');
      (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn().mockRejectedValue(error),
        })),
      }));

      await expect(installDefaultModules('tenant-1', 'free')).resolves.toBeUndefined();
      expect(mockLoggerError).toHaveBeenCalledWith('[auto-install] Failed to install default modules', { error: error.message });
    });
  });
});
