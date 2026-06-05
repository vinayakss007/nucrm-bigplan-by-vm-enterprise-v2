import { describe, it, expect, vi } from 'vitest';

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

describe('Product Registry', () => {
  it('exports exactly 8 product entries', async () => {
    const { PRODUCT_REGISTRY } = await import('@/lib/products/registry');
    const entries = Object.keys(PRODUCT_REGISTRY);
    expect(entries).toHaveLength(8);
  });

  it('includes all expected product IDs', async () => {
    const { PRODUCT_REGISTRY } = await import('@/lib/products/registry');
    const expectedIds = [
      'proposal-generator',
      'ai-sales-crm',
      'whatsapp-automation',
      'helpdesk',
      'recruitment-ats',
      'real-estate-crm',
      'ecommerce-crm',
      'invoice-billing',
    ];
    for (const id of expectedIds) {
      expect(PRODUCT_REGISTRY[id]).toBeDefined();
    }
  });

  it('each product entry has all required fields', async () => {
    const { PRODUCT_REGISTRY } = await import('@/lib/products/registry');
    for (const [key, product] of Object.entries(PRODUCT_REGISTRY)) {
      expect(product.id, `Product "${key}" missing id`).toBe(key);
      expect(product.name, `Product "${key}" missing name`).toBeTruthy();
      expect(product.description, `Product "${key}" missing description`).toBeTruthy();
      expect(product.icon, `Product "${key}" missing icon`).toBeTruthy();
      expect(product.templateId, `Product "${key}" missing templateId`).toBeTruthy();
      expect(product.route, `Product "${key}" missing route`).toBeTruthy();
      expect(product.mainPipeline, `Product "${key}" missing mainPipeline`).toBeTruthy();
    }
  });

  it('each product has dashboardCards array with at least 3 entries', async () => {
    const { PRODUCT_REGISTRY } = await import('@/lib/products/registry');
    for (const [key, product] of Object.entries(PRODUCT_REGISTRY)) {
      expect(Array.isArray(product.dashboardCards), `Product "${key}" dashboardCards not array`).toBe(true);
      expect(product.dashboardCards.length, `Product "${key}" has < 3 dashboard cards`).toBeGreaterThanOrEqual(3);
      for (const card of product.dashboardCards) {
        expect(card.title).toBeTruthy();
        expect(card.stat_key).toBeTruthy();
        expect(card.icon).toBeTruthy();
      }
    }
  });

  it('each product has sidebarItems array with at least 3 entries', async () => {
    const { PRODUCT_REGISTRY } = await import('@/lib/products/registry');
    for (const [key, product] of Object.entries(PRODUCT_REGISTRY)) {
      expect(Array.isArray(product.sidebarItems), `Product "${key}" sidebarItems not array`).toBe(true);
      expect(product.sidebarItems.length, `Product "${key}" has < 3 sidebar items`).toBeGreaterThanOrEqual(3);
      for (const item of product.sidebarItems) {
        expect(item.label).toBeTruthy();
        expect(item.href).toBeTruthy();
        expect(item.icon).toBeTruthy();
      }
    }
  });

  it('each product has quickActions array with at least 2 entries', async () => {
    const { PRODUCT_REGISTRY } = await import('@/lib/products/registry');
    for (const [key, product] of Object.entries(PRODUCT_REGISTRY)) {
      expect(Array.isArray(product.quickActions), `Product "${key}" quickActions not array`).toBe(true);
      expect(product.quickActions.length, `Product "${key}" has < 2 quick actions`).toBeGreaterThanOrEqual(2);
      for (const action of product.quickActions) {
        expect(action.label).toBeTruthy();
        expect(action.action).toBeTruthy();
        expect(action.icon).toBeTruthy();
      }
    }
  });

  it('each product templateId maps to a valid INDUSTRY_TEMPLATES entry', async () => {
    const { PRODUCT_REGISTRY } = await import('@/lib/products/registry');
    const { INDUSTRY_TEMPLATES } = await import('@/lib/modules/industry-templates');
    for (const [key, product] of Object.entries(PRODUCT_REGISTRY)) {
      expect(
        INDUSTRY_TEMPLATES[product.templateId],
        `Product "${key}" templateId "${product.templateId}" not found in INDUSTRY_TEMPLATES`
      ).toBeDefined();
    }
  });

  it('each product route starts with /products/', async () => {
    const { PRODUCT_REGISTRY } = await import('@/lib/products/registry');
    for (const [key, product] of Object.entries(PRODUCT_REGISTRY)) {
      expect(product.route, `Product "${key}" route doesn't start with /products/`).toMatch(/^\/products\//);
    }
  });

  it('product IDs are unique and match their keys', async () => {
    const { PRODUCT_REGISTRY } = await import('@/lib/products/registry');
    const ids = Object.values(PRODUCT_REGISTRY).map(p => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
    for (const [key, product] of Object.entries(PRODUCT_REGISTRY)) {
      expect(product.id).toBe(key);
    }
  });
});
