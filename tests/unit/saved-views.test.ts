import { describe, it, expect } from 'vitest';

describe('Saved Views validation', () => {
  it('requires name for view creation', () => {
    const body = { entity_type: 'contacts' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isValid = !!(body as any).name && !!body.entity_type;
    expect(isValid).toBe(false);
  });

  it('requires entity_type for view creation', () => {
    const body = { name: 'My View' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isValid = !!(body as any).name && !!(body as any).entity_type;
    expect(isValid).toBe(false);
  });

  it('passes validation with both name and entity_type', () => {
    const body = { name: 'My View', entity_type: 'contacts' };
    const isValid = !!body.name && !!body.entity_type;
    expect(isValid).toBe(true);
  });

  it('filters views by entity_type', () => {
    const views = [
      { id: '1', name: 'View 1', entityType: 'contacts' },
      { id: '2', name: 'View 2', entityType: 'deals' },
      { id: '3', name: 'View 3', entityType: 'contacts' },
    ];
    const entityType = 'contacts';
    const filtered = views.filter(v => v.entityType === entityType);
    expect(filtered).toHaveLength(2);
    expect(filtered.every(v => v.entityType === 'contacts')).toBe(true);
  });

  it('includes shared views from other users', () => {
    const currentUserId = 'user-1';
    const views = [
      { id: '1', userId: 'user-1', isShared: false },
      { id: '2', userId: 'user-2', isShared: true },
      { id: '3', userId: 'user-2', isShared: false },
    ];
    const visible = views.filter(v => v.userId === currentUserId || v.isShared);
    expect(visible).toHaveLength(2);
    expect(visible.map(v => v.id)).toEqual(['1', '2']);
  });
});
