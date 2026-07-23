import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock dependencies ──────────────────────────────────
const mockFrom = vi.fn();
const mockSelect = vi.fn(() => ({ from: mockFrom }));
vi.mock('@/drizzle/db', () => ({
  db: { select: mockSelect },
}));

vi.mock('@/drizzle/schema', () => ({
  modules: { id: 'id', name: 'name', manifest: 'manifest' },
}));

vi.mock('@/lib/modules/registry', () => ({
  BUILTIN_MODULES: [
    { id: 'core-crm', name: 'Core CRM', version: '1.0.0', description: 'Contacts & deals', category: 'utility', icon: '📋', pricing: {}, features: ['Contacts'] },
    { id: 'automation-basic', name: 'Basic Automation', version: '1.0.0', description: 'Workflows', category: 'automation', icon: '⚡', pricing: {}, features: ['Workflows'] },
  ],
  ModuleRegistry: {
    checkPlanGate: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

describe('ModuleLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReset();
  });

  it('register adds external module manifest', async () => {
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    const manifest = {
      id: 'custom-module', name: 'Custom', version: '1.0.0',
      description: 'A custom module', category: 'utility' as const,
      icon: '🔧', pricing: {}, features: ['Feature A'],
    };
    moduleLoader.register(manifest);
    const all = moduleLoader.getAll();
    expect(all.some(m => m.id === 'custom-module')).toBe(true);
  });

  it('register does not add duplicate manifests', async () => {
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    const manifest = {
      id: 'dup-module', name: 'Dup', version: '1.0.0',
      description: 'Duplicate', category: 'utility' as const,
      icon: '🔧', pricing: {}, features: [],
    };
    moduleLoader.register(manifest);
    moduleLoader.register(manifest);
    const dupes = moduleLoader.getAll().filter(m => m.id === 'dup-module');
    expect(dupes).toHaveLength(1);
  });

  it('getAll includes built-in modules', async () => {
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    const all = moduleLoader.getAll();
    expect(all.some(m => m.id === 'core-crm')).toBe(true);
    expect(all.some(m => m.id === 'automation-basic')).toBe(true);
  });

  it('get returns undefined for unknown module ID', async () => {
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    expect(moduleLoader.get('nonexistent')).toBeUndefined();
  });

  it('get returns manifest for known module ID', async () => {
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    const result = moduleLoader.get('core-crm');
    expect(result).toBeDefined();
    expect(result!.id).toBe('core-crm');
  });

  it('get returns registered external module by ID', async () => {
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    moduleLoader.register({
      id: 'ext-mod', name: 'External', version: '2.0.0',
      description: 'External module', category: 'ai' as const,
      icon: '🤖', pricing: {}, features: ['AI Feature'],
    });
    const result = moduleLoader.get('ext-mod');
    expect(result).toBeDefined();
    expect(result!.version).toBe('2.0.0');
  });

  it('loadFromDB returns manifests from database rows', async () => {
    mockFrom.mockResolvedValueOnce([
      { id: 'db-mod', name: 'DB Module', manifest: { version: '3.0.0', description: 'From DB', category: 'messaging', icon: '💬', pricing: {}, features: ['msg'] } },
    ]);
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    const result = await moduleLoader.loadFromDB();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('db-mod');
    expect(result[0].version).toBe('3.0.0');
  });

  it('loadFromDB filters rows with null/non-object manifests', async () => {
    mockFrom.mockResolvedValueOnce([
      { id: 'good', name: 'Good', manifest: { version: '1.0.0', description: '', category: 'utility', icon: '✅', pricing: {}, features: [] } },
      { id: 'null-manifest', name: 'Null', manifest: null },
      { id: 'string-manifest', name: 'String', manifest: 'not-an-object' },
    ]);
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    const result = await moduleLoader.loadFromDB();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('good');
  });

  it('loadFromDB applies defaults for missing manifest fields', async () => {
    mockFrom.mockResolvedValueOnce([
      { id: 'minimal', name: 'Minimal', manifest: {} },
    ]);
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    const result = await moduleLoader.loadFromDB();
    expect(result[0].version).toBe('1.0.0');
    expect(result[0].category).toBe('utility');
    expect(result[0].icon).toBe('🔌');
    expect(result[0].features).toEqual([]);
  });

  it('checkPlanGate delegates to ModuleRegistry.checkPlanGate', async () => {
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    const { ModuleRegistry } = await import('@/lib/modules/registry');
    const result = await moduleLoader.checkPlanGate('tenant-1', 'core-crm');
    expect(ModuleRegistry.checkPlanGate).toHaveBeenCalledWith('tenant-1', 'core-crm');
    expect(result.ok).toBe(true);
  });
});
