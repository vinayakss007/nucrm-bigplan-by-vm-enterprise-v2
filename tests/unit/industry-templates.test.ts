import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock drizzle DB before importing modules that use it
vi.mock('@/drizzle/db', () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoNothing: vi.fn() })) })),
    select: vi.fn(),
    query: {},
  },
}));

vi.mock('@/drizzle/schema/modules', () => ({
  modules: {},
  tenantModules: {},
}));

describe('Industry Templates', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports exactly 13 templates', async () => {
    const { INDUSTRY_TEMPLATES } = await import('@/lib/modules/industry-templates');
    const templateIds = Object.keys(INDUSTRY_TEMPLATES);
    expect(templateIds).toHaveLength(13);
  });

  it('includes all expected template IDs', async () => {
    const { INDUSTRY_TEMPLATES } = await import('@/lib/modules/industry-templates');
    const expectedIds = [
      'real_estate', 'saas', 'consulting',
      'recruitment_hr', 'insurance', 'healthcare',
      'education', 'ecommerce', 'legal',
      'fitness_wellness', 'travel', 'automotive',
      'financial_services',
    ];
    for (const id of expectedIds) {
      expect(INDUSTRY_TEMPLATES[id]).toBeDefined();
    }
  });

  it('each template has required fields', async () => {
    const { INDUSTRY_TEMPLATES } = await import('@/lib/modules/industry-templates');
    for (const [key, template] of Object.entries(INDUSTRY_TEMPLATES)) {
      expect(template.id).toBe(key);
      expect(template.name).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(template.icon).toBeTruthy();
      expect(Array.isArray(template.modules)).toBe(true);
      expect(template.modules.length).toBeGreaterThan(0);
      expect(Array.isArray(template.custom_fields)).toBe(true);
      expect(template.custom_fields.length).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(template.pipelines)).toBe(true);
      expect(template.pipelines.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(template.automations)).toBe(true);
      expect(template.automations.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('each template has valid module references from BUILTIN_MODULES', async () => {
    const { INDUSTRY_TEMPLATES } = await import('@/lib/modules/industry-templates');
    const { BUILTIN_MODULES } = await import('@/lib/modules/registry');
    const validModuleIds = new Set(BUILTIN_MODULES.map(m => m.id));

    for (const [key, template] of Object.entries(INDUSTRY_TEMPLATES)) {
      for (const moduleId of template.modules) {
        expect(validModuleIds.has(moduleId), `Template "${key}" references invalid module "${moduleId}"`).toBe(true);
      }
    }
  });

  it('each template custom_field has valid entity type', async () => {
    const { INDUSTRY_TEMPLATES } = await import('@/lib/modules/industry-templates');
    const validEntities = new Set(['contact', 'deal', 'company']);

    for (const [key, template] of Object.entries(INDUSTRY_TEMPLATES)) {
      for (const field of template.custom_fields) {
        expect(validEntities.has(field.entity), `Template "${key}" field "${field.key}" has invalid entity "${field.entity}"`).toBe(true);
        expect(field.label).toBeTruthy();
        expect(field.key).toBeTruthy();
        expect(field.type).toBeTruthy();
      }
    }
  });

  it('each template pipeline has at least 4 stages', async () => {
    const { INDUSTRY_TEMPLATES } = await import('@/lib/modules/industry-templates');

    for (const [key, template] of Object.entries(INDUSTRY_TEMPLATES)) {
      for (const pipeline of template.pipelines) {
        expect(pipeline.name).toBeTruthy();
        expect(pipeline.stages.length, `Template "${key}" pipeline "${pipeline.name}" has fewer than 4 stages`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('each template automation has required fields', async () => {
    const { INDUSTRY_TEMPLATES } = await import('@/lib/modules/industry-templates');

    for (const [key, template] of Object.entries(INDUSTRY_TEMPLATES)) {
      for (const automation of template.automations) {
        expect(automation.name, `Template "${key}" has automation with empty name`).toBeTruthy();
        expect(automation.trigger, `Template "${key}" automation "${automation.name}" has empty trigger`).toBeTruthy();
        expect(automation.action, `Template "${key}" automation "${automation.name}" has empty action`).toBeTruthy();
        expect(automation.config).toBeDefined();
      }
    }
  });

  it('IndustryTemplate interface includes modules field', async () => {
    const { INDUSTRY_TEMPLATES } = await import('@/lib/modules/industry-templates');
    const firstTemplate = Object.values(INDUSTRY_TEMPLATES)[0];
    expect(firstTemplate).toBeDefined();
    expect(firstTemplate!.modules).toBeDefined();
    expect(Array.isArray(firstTemplate!.modules)).toBe(true);
  });
});

describe('Auto-Install with Templates', () => {
  it('getDefaultModulesForPlan returns correct modules for free plan', async () => {
    const { getDefaultModulesForPlan } = await import('@/lib/modules/auto-install');
    const modules = getDefaultModulesForPlan('free');
    expect(modules).toContain('core-crm');
    expect(modules).toContain('automation-basic');
    expect(modules).toHaveLength(2);
  });

  it('getDefaultModulesForPlan returns correct modules for enterprise plan', async () => {
    const { getDefaultModulesForPlan } = await import('@/lib/modules/auto-install');
    const modules = getDefaultModulesForPlan('enterprise');
    expect(modules).toContain('core-crm');
    expect(modules).toContain('ai-assistant');
    expect(modules).toContain('industry-templates');
    expect(modules.length).toBeGreaterThan(10);
  });

  it('getDefaultModulesForPlan returns free modules for unknown plan', async () => {
    const { getDefaultModulesForPlan } = await import('@/lib/modules/auto-install');
    const modules = getDefaultModulesForPlan('nonexistent');
    expect(modules).toContain('core-crm');
    expect(modules).toContain('automation-basic');
  });

  it('getModulesForPlanAndTemplate merges plan and template modules', async () => {
    const { getModulesForPlanAndTemplate } = await import('@/lib/modules/auto-install');
    const modules = getModulesForPlanAndTemplate('free', 'saas');
    // Should include both free plan modules and SaaS template modules
    expect(modules).toContain('core-crm');
    expect(modules).toContain('automation-basic');
    expect(modules).toContain('automation-pro');
    expect(modules).toContain('ai-assistant');
    // No duplicates
    const uniqueModules = new Set(modules);
    expect(uniqueModules.size).toBe(modules.length);
  });

  it('getModulesForPlanAndTemplate returns plan modules for invalid template', async () => {
    const { getModulesForPlanAndTemplate } = await import('@/lib/modules/auto-install');
    const modules = getModulesForPlanAndTemplate('starter', 'nonexistent_template');
    const { getDefaultModulesForPlan } = await import('@/lib/modules/auto-install');
    const planModules = getDefaultModulesForPlan('starter');
    expect(modules).toEqual(planModules);
  });

  it('getTemplateModules returns valid modules for real_estate', async () => {
    const { getTemplateModules } = await import('@/lib/modules/auto-install');
    const modules = getTemplateModules('real_estate');
    expect(modules).toContain('core-crm');
    expect(modules).toContain('forms-builder');
    expect(modules.length).toBeGreaterThan(0);
  });

  it('getTemplateModules returns empty array for unknown template', async () => {
    const { getTemplateModules } = await import('@/lib/modules/auto-install');
    const modules = getTemplateModules('nonexistent');
    expect(modules).toEqual([]);
  });

  it('getTemplateModules only returns modules that exist in BUILTIN_MODULES', async () => {
    const { getTemplateModules } = await import('@/lib/modules/auto-install');
    const { BUILTIN_MODULES } = await import('@/lib/modules/registry');
    const validIds = new Set(BUILTIN_MODULES.map(m => m.id));

    const { INDUSTRY_TEMPLATES } = await import('@/lib/modules/industry-templates');
    for (const templateId of Object.keys(INDUSTRY_TEMPLATES)) {
      const modules = getTemplateModules(templateId);
      for (const moduleId of modules) {
        expect(validIds.has(moduleId)).toBe(true);
      }
    }
  });
});
