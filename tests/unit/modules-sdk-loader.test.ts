import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCheckPlanGate = vi.fn();
const mockBuiltinModules = [
  { id: 'crm', name: 'CRM Core', version: '1.0.0', description: 'Core CRM', category: 'core' },
  { id: 'email', name: 'Email', version: '1.0.0', description: 'Email integration', category: 'communication' },
];

vi.mock('@/lib/modules/registry', () => ({
  BUILTIN_MODULES: mockBuiltinModules,
  ModuleRegistry: { checkPlanGate: mockCheckPlanGate },
}));

const mockDbFrom = vi.fn();
const mockDbSelect = vi.fn(() => ({ from: mockDbFrom }));

vi.mock('@/drizzle/db', () => ({ db: { select: mockDbSelect } }));
vi.mock('@/drizzle/schema', () => ({ modules: {} }));

describe('moduleLoader', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('getAll returns built-in modules initially', async () => {
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    const all = moduleLoader.getAll();
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe('crm');
    expect(all[1].id).toBe('email');
  });

  it('register adds external modules', async () => {
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    moduleLoader.register({ id: 'analytics', name: 'Analytics', version: '2.0.0', description: '', category: 'insights' });
    const all = moduleLoader.getAll();
    expect(all).toHaveLength(3);
    expect(all.find(m => m.id === 'analytics')).toBeDefined();
  });

  it('register ignores duplicate external ids', async () => {
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    moduleLoader.register({ id: 'ext', name: 'First', version: '1.0.0', description: '', category: 'utility' });
    moduleLoader.register({ id: 'ext', name: 'Duplicate', version: '1.0.0', description: '', category: 'utility' });
    const all = moduleLoader.getAll();
    expect(all).toHaveLength(3);
    const ext = all.find(m => m.id === 'ext');
    expect(ext!.name).toBe('First');
  });

  it('get returns module by id', async () => {
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    const mod = moduleLoader.get('crm');
    expect(mod).toBeDefined();
    expect(mod!.name).toBe('CRM Core');
  });

  it('get returns undefined for unknown id', async () => {
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    const mod = moduleLoader.get('nonexistent');
    expect(mod).toBeUndefined();
  });

  it('get searches built-in and external modules', async () => {
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    moduleLoader.register({ id: 'external-plugin', name: 'Plugin', version: '1.0.0', description: '', category: 'utility' });
    expect(moduleLoader.get('external-plugin')).toBeDefined();
  });

  it('loadFromDB returns mapped module manifests', async () => {
    mockDbFrom.mockResolvedValue([
      { id: 'mod-1', name: 'Module One', manifest: { version: '2.0.0', description: 'First module', category: 'billing', icon: '💰', pricing: { monthly: 10 }, features: ['f1'], permissions: ['p1'], pages: [{ title: 'Page' }], settings_schema: [{ field: 'key' }], webhooks: [{ event: 'test' }], dependsOn: ['crm'], author: 'Test' } },
    ]);
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    const result = await moduleLoader.loadFromDB();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('mod-1');
    expect(result[0].version).toBe('2.0.0');
    expect(result[0].author).toBe('Test');
  });

  it('loadFromDB filters rows with null manifest', async () => {
    mockDbFrom.mockResolvedValue([
      { id: 'good', name: 'Good', manifest: { version: '1.0.0' } },
      { id: 'bad', name: 'Bad', manifest: null },
    ]);
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    const result = await moduleLoader.loadFromDB();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('good');
  });

  it('loadFromDB uses defaults for missing manifest fields', async () => {
    mockDbFrom.mockResolvedValue([
      { id: 'minimal', name: 'Minimal', manifest: {} },
    ]);
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    const result = await moduleLoader.loadFromDB();
    expect(result[0].version).toBe('1.0.0');
    expect(result[0].description).toBe('');
    expect(result[0].category).toBe('utility');
    expect(result[0].icon).toBe('🔌');
    expect(result[0].pricing).toEqual({});
    expect(result[0].features).toEqual([]);
    expect(result[0].author).toBe('Unknown');
  });

  it('loadFromDB returns empty array when no rows', async () => {
    mockDbFrom.mockResolvedValue([]);
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    const result = await moduleLoader.loadFromDB();
    expect(result).toEqual([]);
  });

  it('checkPlanGate delegates to ModuleRegistry', async () => {
    mockCheckPlanGate.mockResolvedValue({ ok: true });
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    const result = await moduleLoader.checkPlanGate('tenant-1', 'crm');
    expect(result).toEqual({ ok: true });
    expect(mockCheckPlanGate).toHaveBeenCalledWith('tenant-1', 'crm');
  });

  it('checkPlanGate returns error when gate fails', async () => {
    mockCheckPlanGate.mockResolvedValue({ ok: false, error: 'Plan limit reached' });
    const { moduleLoader } = await import('@/lib/modules/sdk/loader');
    const result = await moduleLoader.checkPlanGate('tenant-1', 'premium');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Plan limit reached');
  });
});
