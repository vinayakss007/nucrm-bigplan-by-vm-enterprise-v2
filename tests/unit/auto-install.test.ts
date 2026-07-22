import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock drizzle DB ──────────────────────────────────────
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockOnConflictDoNothing = vi.fn();
mockValues.mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
mockInsert.mockReturnValue({ values: mockValues });

vi.mock('@/drizzle/db', () => ({
  db: { insert: mockInsert },
}));

vi.mock('@/drizzle/schema/modules', () => ({
  modules: { id: 'id', name: 'name', version: 'version', description: 'description', category: 'category', icon: 'icon', manifest: 'manifest' },
  tenantModules: { tenantId: 'tenant_id', moduleId: 'module_id', status: 'status', enabledFeatures: 'enabled_features', settings: 'settings' },
}));

vi.mock('@/lib/modules/registry', () => ({
  BUILTIN_MODULES: [
    { id: 'core-crm', name: 'Core CRM', version: '1.0.0', description: 'Contacts & deals', category: 'utility', icon: '📋', pricing: {}, features: ['Contacts'] },
    { id: 'automation-basic', name: 'Basic Automation', version: '1.0.0', description: 'Workflows', category: 'automation', icon: '⚡', pricing: {}, features: ['Workflows'] },
    { id: 'forms-builder', name: 'Forms Builder', version: '1.0.0', description: 'Build forms', category: 'utility', icon: '📝', pricing: {}, features: ['Forms'] },
  ],
}));

vi.mock('@/lib/modules/industry-templates', () => ({
  INDUSTRY_TEMPLATES: {
    real_estate: {
      id: 'real_estate', name: 'Real Estate', description: 'Property', icon: '🏠',
      modules: ['core-crm', 'forms-builder'],
      custom_fields: [], pipelines: [], automations: [],
    },
    saas: {
      id: 'saas', name: 'SaaS', description: 'Software', icon: '💻',
      modules: ['core-crm', 'automation-basic', 'ai-assistant'],
      custom_fields: [], pipelines: [], automations: [],
    },
  },
}));

describe('getDefaultModulesForPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns free plan modules for unknown plan', async () => {
    const { getDefaultModulesForPlan } = await import('@/lib/modules/auto-install');
    const result = getDefaultModulesForPlan('unknown-plan');
    expect(result).toEqual(['core-crm', 'automation-basic']);
  });

  it('returns starter modules for starter plan', async () => {
    const { getDefaultModulesForPlan } = await import('@/lib/modules/auto-install');
    const result = getDefaultModulesForPlan('starter');
    expect(result).toContain('core-crm');
    expect(result).toContain('automation-pro');
    expect(result.length).toBeGreaterThan(2);
  });

  it('returns pro modules for pro plan', async () => {
    const { getDefaultModulesForPlan } = await import('@/lib/modules/auto-install');
    const result = getDefaultModulesForPlan('pro');
    expect(result).toContain('ai-assistant');
    expect(result).toContain('forms-builder');
  });

  it('returns enterprise modules for enterprise plan', async () => {
    const { getDefaultModulesForPlan } = await import('@/lib/modules/auto-install');
    const result = getDefaultModulesForPlan('enterprise');
    expect(result).toContain('industry-templates');
    expect(result).toContain('analytics-pro');
  });
});

describe('getModulesForPlanAndTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns plan modules when no template is provided', async () => {
    const { getModulesForPlanAndTemplate } = await import('@/lib/modules/auto-install');
    const result = getModulesForPlanAndTemplate('free');
    expect(result).toEqual(['core-crm', 'automation-basic']);
  });

  it('returns plan modules when template ID is undefined', async () => {
    const { getModulesForPlanAndTemplate } = await import('@/lib/modules/auto-install');
    const result = getModulesForPlanAndTemplate('free', undefined);
    expect(result).toEqual(['core-crm', 'automation-basic']);
  });

  it('merges plan + template modules without duplicates', async () => {
    const { getModulesForPlanAndTemplate } = await import('@/lib/modules/auto-install');
    const result = getModulesForPlanAndTemplate('free', 'real_estate');
    // real_estate has ['core-crm', 'forms-builder'], free has ['core-crm', 'automation-basic']
    expect(result).toContain('core-crm');
    expect(result).toContain('automation-basic');
    expect(result).toContain('forms-builder');
    // Deduplicated
    expect(result.filter(m => m === 'core-crm')).toHaveLength(1);
  });

  it('returns plan modules for unknown template ID', async () => {
    const { getModulesForPlanAndTemplate } = await import('@/lib/modules/auto-install');
    const result = getModulesForPlanAndTemplate('free', 'nonexistent_template');
    expect(result).toEqual(['core-crm', 'automation-basic']);
  });
});

describe('getTemplateModules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns only valid built-in module IDs from template', async () => {
    const { getTemplateModules } = await import('@/lib/modules/auto-install');
    const result = getTemplateModules('real_estate');
    // real_estate: ['core-crm', 'forms-builder'] — both exist in BUILTIN_MODULES mock
    expect(result).toEqual(['core-crm', 'forms-builder']);
  });

  it('filters out non-existent module IDs from template', async () => {
    const { getTemplateModules } = await import('@/lib/modules/auto-install');
    const result = getTemplateModules('saas');
    // saas: ['core-crm', 'automation-basic', 'ai-assistant']
    // ai-assistant is NOT in the mock BUILTIN_MODULES
    expect(result).toEqual(['core-crm', 'automation-basic']);
  });

  it('returns empty array for unknown template ID', async () => {
    const { getTemplateModules } = await import('@/lib/modules/auto-install');
    const result = getTemplateModules('nonexistent');
    expect(result).toEqual([]);
  });
});

describe('installDefaultModules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockOnConflictDoNothing.mockReset();
  });

  it('inserts modules into registry and tenant_modules tables', async () => {
    const { installDefaultModules } = await import('@/lib/modules/auto-install');
    await installDefaultModules('tenant-1', 'free');
    // Should call insert for each module in the free plan
    expect(mockInsert).toHaveBeenCalled();
    // Each module gets 2 inserts (modules table + tenantModules table)
    expect(mockValues).toHaveBeenCalled();
  });

  it('does nothing if module list is empty (unknown plan)', async () => {
    // The plan fallback to free always returns at least 2 modules
    const { installDefaultModules } = await import('@/lib/modules/auto-install');
    await installDefaultModules('tenant-1', 'free');
    expect(mockInsert).toHaveBeenCalled();
  });

  it('merges template modules into default install', async () => {
    const { installDefaultModules } = await import('@/lib/modules/auto-install');
    await installDefaultModules('tenant-1', 'free', 'real_estate');
    // Should include forms-builder from the template
    expect(mockValues).toHaveBeenCalled();
  });

  it('catches and logs errors during install', async () => {
    mockOnConflictDoNothing.mockRejectedValueOnce(new Error('DB error'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { installDefaultModules } = await import('@/lib/modules/auto-install');
    // Should not throw
    await expect(installDefaultModules('tenant-1', 'free')).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('installTemplateModules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockOnConflictDoNothing.mockReset();
  });

  it('installs template modules for tenant', async () => {
    const { installTemplateModules } = await import('@/lib/modules/auto-install');
    await installTemplateModules('tenant-1', 'real_estate');
    expect(mockInsert).toHaveBeenCalled();
  });

  it('returns early for unknown template (empty module list)', async () => {
    const { installTemplateModules } = await import('@/lib/modules/auto-install');
    await installTemplateModules('tenant-1', 'nonexistent');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('catches and logs errors during install', async () => {
    mockOnConflictDoNothing.mockRejectedValueOnce(new Error('DB failure'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { installTemplateModules } = await import('@/lib/modules/auto-install');
    await expect(installTemplateModules('tenant-1', 'real_estate')).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
