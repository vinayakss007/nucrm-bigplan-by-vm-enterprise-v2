import { describe, it, expect } from 'vitest';

describe('permissions/definitions', () => {
  it('PERMISSIONS is a non-empty array', async () => {
    const { PERMISSIONS } = await import('@/lib/permissions/definitions');
    expect(Array.isArray(PERMISSIONS)).toBe(true);
    expect(PERMISSIONS.length).toBeGreaterThan(0);
  });

  it('each permission has valid shape', async () => {
    const { PERMISSIONS } = await import('@/lib/permissions/definitions');
    for (const p of PERMISSIONS) {
      expect(p.id).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(p.label).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(p.category).toBeTruthy();
      expect(['safe', 'moderate', 'danger']).toContain(p.dangerLevel);
    }
  });

  it('includes contacts permissions', async () => {
    const { PERMISSIONS } = await import('@/lib/permissions/definitions');
    const ids = PERMISSIONS.map(p => p.id);
    expect(ids).toContain('contacts.view_all');
    expect(ids).toContain('contacts.create');
    expect(ids).toContain('contacts.delete');
  });

  it('includes leads permissions', async () => {
    const { PERMISSIONS } = await import('@/lib/permissions/definitions');
    const ids = PERMISSIONS.map(p => p.id);
    expect(ids).toContain('leads.view');
    expect(ids).toContain('leads.edit');
  });

  it('includes deals permissions', async () => {
    const { PERMISSIONS } = await import('@/lib/permissions/definitions');
    const ids = PERMISSIONS.map(p => p.id);
    expect(ids).toContain('deals.view');
    expect(ids).toContain('deals.edit');
  });

  it('includes team permissions', async () => {
    const { PERMISSIONS } = await import('@/lib/permissions/definitions');
    const ids = PERMISSIONS.map(p => p.id);
    expect(ids).toContain('team.view');
    expect(ids).toContain('team.manage_roles');
  });

  it('no duplicate permission IDs', async () => {
    const { PERMISSIONS } = await import('@/lib/permissions/definitions');
    const ids = PERMISSIONS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('PERMISSION_CATEGORIES is derived', async () => {
    const { PERMISSION_CATEGORIES } = await import('@/lib/permissions/definitions');
    expect(Array.isArray(PERMISSION_CATEGORIES)).toBe(true);
    expect(PERMISSION_CATEGORIES.length).toBeGreaterThan(0);
  });
});
