/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSelectChain, mockInsertChain, mockUpdateChain, mockEqFn, mockAndFn } = vi.hoisted(() => ({
  mockSelectChain: vi.fn(),
  mockInsertChain: vi.fn(),
  mockUpdateChain: vi.fn(),
  mockEqFn: vi.fn((_col: any, _val: any) => `eq(${String(_val)})`),
  mockAndFn: vi.fn((..._args: any[]) => 'and()'),
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: mockSelectChain,
    insert: (...args: any[]) => mockInsertChain(...args),
    update: (...args: any[]) => mockUpdateChain(...args),
  },
}));

vi.mock('@/drizzle/schema/core', () => ({
  fieldPermissions: {
    id: 'id',
    tenantId: 'tenant_id',
    roleId: 'role_id',
    entityType: 'entity_type',
    fieldName: 'field_name',
    accessLevel: 'access_level',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: mockEqFn,
  and: mockAndFn,
}));

import {
  getFieldPermissions,
  checkFieldAccess,
  filterFieldsByPermission,
  setFieldPermission,
} from '@/lib/rbac/field-permissions';

function mockWhereChain(rows: any[]) {
  return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(rows) })) };
}

describe('field-permissions', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('getFieldPermissions', () => {
    it('returns permission rows', async () => {
      const rows = [{ fieldName: 'email', accessLevel: 'write' }];
      mockSelectChain.mockReturnValue(mockWhereChain(rows));
      const r = await getFieldPermissions('t1', 'agent', 'contact');
      expect(r.length).toBe(1);
      expect(r[0].fieldName).toBe('email');
      expect(r[0].accessLevel).toBe('write');
    });

    it('returns empty array when no permissions', async () => {
      mockSelectChain.mockReturnValue(mockWhereChain([]));
      const r = await getFieldPermissions('t1', 'agent', 'contact');
      expect(r).toEqual([]);
    });
  });

  describe('checkFieldAccess', () => {
    it('returns accessLevel when permission found', async () => {
      mockSelectChain.mockReturnValue(mockWhereChain([{ accessLevel: 'read' }]));
      const r = await checkFieldAccess('t1', 'agent', 'contact', 'email');
      expect(r).toBe('read');
    });

    it('returns "write" default when no permission found', async () => {
      mockSelectChain.mockReturnValue(mockWhereChain([]));
      const r = await checkFieldAccess('t1', 'agent', 'contact', 'email');
      expect(r).toBe('write');
    });

    it('returns none access level', async () => {
      mockSelectChain.mockReturnValue(mockWhereChain([{ accessLevel: 'none' }]));
      const r = await checkFieldAccess('t1', 'agent', 'contact', 'email');
      expect(r).toBe('none');
    });
  });

  describe('filterFieldsByPermission', () => {
    it('returns all fields when no permissions defined (default open)', async () => {
      mockSelectChain.mockReturnValue(mockWhereChain([]));
      const r = await filterFieldsByPermission('t1', 'agent', 'contact', {
        email: 'test@test.com',
        phone: '123',
      });
      expect(r).toEqual({ email: 'test@test.com', phone: '123' });
    });

    it('returns all fields when admin (bypasses)', async () => {
      const r = await filterFieldsByPermission('t1', 'admin', 'contact', {
        email: 'test@test.com',
        phone: '123',
        name: 'John',
      }, 'read');
      expect(Object.keys(r)).toEqual(expect.arrayContaining(['email', 'phone', 'name']));
    });

    it('filters fields based on permissions', async () => {
      const perms = [
        { fieldName: 'email', accessLevel: 'write' },
        { fieldName: 'phone', accessLevel: 'none' },
      ];
      mockSelectChain.mockReturnValue(mockWhereChain(perms));
      const r = await filterFieldsByPermission('t1', 'agent', 'contact', {
        email: 'test@test.com',
        phone: '123',
        name: 'John',
      });
      expect(r).toEqual({ email: 'test@test.com', name: 'John' });
    });

    it('includes fields not in perm map', async () => {
      mockSelectChain.mockReturnValue(mockWhereChain([]));
      const r = await filterFieldsByPermission('t1', 'agent', 'contact', {
        custom: 'value',
      });
      expect(r).toEqual({ custom: 'value' });
    });
  });

  describe('setFieldPermission', () => {
    it('inserts new permission when none exists', async () => {
      mockSelectChain.mockReturnValue(mockWhereChain([]));
      mockInsertChain.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1, fieldName: 'email', accessLevel: 'read' }]),
        }),
      });
      const r = await setFieldPermission('t1', 'agent', 'contact', 'email', 'read');
      expect(r).toEqual({ id: 1, fieldName: 'email', accessLevel: 'read' });
      expect(mockInsertChain).toHaveBeenCalled();
    });

    it('updates existing permission', async () => {
      const existing = { id: 1, fieldName: 'email', accessLevel: 'none' };
      mockSelectChain.mockReturnValue(mockWhereChain([existing]));
      mockUpdateChain.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });
      const r = await setFieldPermission('t1', 'agent', 'contact', 'email', 'write');
      expect(r.accessLevel).toBe('write');
      expect(mockUpdateChain).toHaveBeenCalled();
    });
  });
});
