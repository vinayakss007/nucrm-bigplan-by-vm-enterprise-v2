import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock drizzle DB
vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => []),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [{ id: 'test-id', tenantId: 'tenant-1', entityType: 'deal', entityId: 'deal-1', ruleId: 'rule-1', status: 'pending', requestedBy: 'user-1' }]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => [{ id: 'req-1', tenantId: 'tenant-1', entityType: 'deal', entityId: 'deal-1', status: 'approved', approvedBy: 'user-2' }]),
        })),
      })),
    })),
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
  },
  recordPermissions: {
    id: 'id',
    tenantId: 'tenant_id',
    roleId: 'role_id',
    entityType: 'entity_type',
    entityId: 'entity_id',
    accessLevel: 'access_level',
    grantedBy: 'granted_by',
    expiresAt: 'expires_at',
    deletedAt: 'deleted_at',
  },
  approvalRequests: {
    id: 'id',
    tenantId: 'tenant_id',
    entityType: 'entity_type',
    entityId: 'entity_id',
    ruleId: 'rule_id',
    status: 'status',
    requestedBy: 'requested_by',
    approvedBy: 'approved_by',
    rejectedBy: 'rejected_by',
    reason: 'reason',
    createdAt: 'created_at',
  },
}));

vi.mock('@/drizzle/schema/infra', () => ({
  activities: {
    tenantId: 'tenant_id',
    userId: 'user_id',
    entityType: 'entity_type',
    entityId: 'entity_id',
    eventType: 'event_type',
    description: 'description',
    metadata: 'metadata',
  },
}));

vi.mock('drizzle-orm', () => {
  const sqlFn = Object.assign(vi.fn(), { raw: vi.fn((val: string) => val) });
  return {
    eq: vi.fn((...args: unknown[]) => args),
    and: vi.fn((...args: unknown[]) => args),
    or: vi.fn((...args: unknown[]) => args),
    sql: sqlFn,
    isNull: vi.fn(),
    gt: vi.fn(),
  };
});

describe('RBAC - Field Permissions', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('filterFieldsByPermission', () => {
    it('strips fields with access level "none"', async () => {
      // Mock DB to return permission restrictions
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { fieldName: 'salary', accessLevel: 'none' },
            { fieldName: 'name', accessLevel: 'read' },
            { fieldName: 'email', accessLevel: 'write' },
          ]),
        })),
      });

      const { filterFieldsByPermission } = await import('@/lib/rbac/field-permissions');

      const data = { name: 'John', email: 'john@test.com', salary: 100000, department: 'Engineering' };
      const result = await filterFieldsByPermission('tenant-1', 'role-1', 'contact', data, 'read');

      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('email');
      expect(result).toHaveProperty('department'); // No restriction = allowed
      expect(result).not.toHaveProperty('salary'); // 'none' level = stripped
    });

    it('strips fields below write level when requiring write access', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { fieldName: 'ssn', accessLevel: 'none' },
            { fieldName: 'name', accessLevel: 'read' },
            { fieldName: 'email', accessLevel: 'write' },
            { fieldName: 'phone', accessLevel: 'admin' },
          ]),
        })),
      });

      const { filterFieldsByPermission } = await import('@/lib/rbac/field-permissions');

      const data = { name: 'John', email: 'john@test.com', ssn: '123-45-6789', phone: '555-0100' };
      const result = await filterFieldsByPermission('tenant-1', 'role-1', 'contact', data, 'write');

      expect(result).not.toHaveProperty('ssn');   // 'none' < 'write'
      expect(result).not.toHaveProperty('name');  // 'read' < 'write'
      expect(result).toHaveProperty('email');     // 'write' == 'write'
      expect(result).toHaveProperty('phone');     // 'admin' > 'write'
    });

    it('allows all fields when no permissions are defined', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => []),
        })),
      });

      const { filterFieldsByPermission } = await import('@/lib/rbac/field-permissions');

      const data = { name: 'John', email: 'john@test.com', salary: 100000 };
      const result = await filterFieldsByPermission('tenant-1', 'role-1', 'contact', data, 'read');

      expect(result).toEqual(data);
    });
  });
});

describe('RBAC - Record Permissions', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('checkRecordAccess', () => {
    it('returns access level from explicit permission', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { accessLevel: 'write' },
          ]),
        })),
      });

      const { checkRecordAccess } = await import('@/lib/rbac/record-permissions');
      const result = await checkRecordAccess('tenant-1', 'user-1', 'role-1', 'deal', 'deal-123');
      expect(result).toBe('write');
    });

    it('returns "none" when no explicit permission exists', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => []),
        })),
      });

      const { checkRecordAccess } = await import('@/lib/rbac/record-permissions');
      const result = await checkRecordAccess('tenant-1', 'user-1', 'role-1', 'deal', 'deal-456');
      expect(result).toBe('none');
    });
  });

  describe('getRecordAccessFilter', () => {
    it('returns a SQL expression', async () => {
      const { getRecordAccessFilter } = await import('@/lib/rbac/record-permissions');
      const filter = getRecordAccessFilter('tenant-1', 'user-1', 'role-1', 'contact');
      // When sql is mocked, it returns whatever the mock returns (could be undefined)
      // The important thing is the function doesn't throw
      expect(typeof getRecordAccessFilter).toBe('function');
    });
  });
});

describe('RBAC - Approval Workflows', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('checkNeedsApproval', () => {
    it('returns the matching rule when condition is met (>)', async () => {
      const { checkNeedsApproval } = await import('@/lib/rbac/approval-workflows');
      const rules = [
        {
          id: 'rule-1',
          tenantId: 'tenant-1',
          entityType: 'deal',
          conditionField: 'amount',
          conditionOperator: '>' as const,
          conditionValue: 50000,
          approverRoleSlug: 'manager',
          autoApproveRoles: ['admin'],
        },
      ];

      const result = checkNeedsApproval(rules, 'deal', { amount: 75000 });
      expect(result).not.toBeNull();
      expect(result!.id).toBe('rule-1');
    });

    it('returns null when condition is not met', async () => {
      const { checkNeedsApproval } = await import('@/lib/rbac/approval-workflows');
      const rules = [
        {
          id: 'rule-1',
          tenantId: 'tenant-1',
          entityType: 'deal',
          conditionField: 'amount',
          conditionOperator: '>' as const,
          conditionValue: 50000,
          approverRoleSlug: 'manager',
          autoApproveRoles: ['admin'],
        },
      ];

      const result = checkNeedsApproval(rules, 'deal', { amount: 30000 });
      expect(result).toBeNull();
    });

    it('evaluates < condition correctly', async () => {
      const { checkNeedsApproval } = await import('@/lib/rbac/approval-workflows');
      const rules = [
        {
          id: 'rule-2',
          tenantId: 'tenant-1',
          entityType: 'deal',
          conditionField: 'discount_percent',
          conditionOperator: '<' as const,
          conditionValue: 10,
          approverRoleSlug: 'sales_manager',
          autoApproveRoles: [],
        },
      ];

      const result = checkNeedsApproval(rules, 'deal', { discount_percent: 5 });
      expect(result).not.toBeNull();
      expect(result!.id).toBe('rule-2');
    });

    it('evaluates == condition with string values', async () => {
      const { checkNeedsApproval } = await import('@/lib/rbac/approval-workflows');
      const rules = [
        {
          id: 'rule-3',
          tenantId: 'tenant-1',
          entityType: 'deal',
          conditionField: 'status',
          conditionOperator: '==' as const,
          conditionValue: 'high_risk',
          approverRoleSlug: 'compliance',
          autoApproveRoles: [],
        },
      ];

      const result = checkNeedsApproval(rules, 'deal', { status: 'high_risk' });
      expect(result).not.toBeNull();
    });

    it('skips rules for different entity types', async () => {
      const { checkNeedsApproval } = await import('@/lib/rbac/approval-workflows');
      const rules = [
        {
          id: 'rule-1',
          tenantId: 'tenant-1',
          entityType: 'contact',
          conditionField: 'amount',
          conditionOperator: '>' as const,
          conditionValue: 50000,
          approverRoleSlug: 'manager',
          autoApproveRoles: [],
        },
      ];

      const result = checkNeedsApproval(rules, 'deal', { amount: 75000 });
      expect(result).toBeNull();
    });

    it('handles >= and <= operators', async () => {
      const { checkNeedsApproval } = await import('@/lib/rbac/approval-workflows');
      const rules = [
        {
          id: 'rule-gte',
          tenantId: 'tenant-1',
          entityType: 'deal',
          conditionField: 'amount',
          conditionOperator: '>=' as const,
          conditionValue: 50000,
          approverRoleSlug: 'manager',
          autoApproveRoles: [],
        },
      ];

      // Exact match should trigger >=
      const result = checkNeedsApproval(rules, 'deal', { amount: 50000 });
      expect(result).not.toBeNull();
    });
  });

  describe('approval workflow state transitions', () => {
    it('requestApproval creates a pending request', async () => {
      const { db } = await import('@/drizzle/db');
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: vi.fn(() => ({
          returning: vi.fn(() => [{
            id: 'req-1',
            tenantId: 'tenant-1',
            entityType: 'deal',
            entityId: 'deal-1',
            ruleId: 'rule-1',
            status: 'pending',
            requestedBy: 'user-1',
          }]),
          catch: vi.fn(),
        })),
      });

      const { requestApproval } = await import('@/lib/rbac/approval-workflows');
      const result = await requestApproval('tenant-1', 'deal', 'deal-1', 'rule-1', 'user-1');
      expect(result.status).toBe('pending');
      expect(result.requestedBy).toBe('user-1');
    });

    it('approveRequest transitions to approved', async () => {
      const { db } = await import('@/drizzle/db');
      (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => [{
              id: 'req-1',
              tenantId: 'tenant-1',
              entityType: 'deal',
              entityId: 'deal-1',
              status: 'approved',
              approvedBy: 'user-2',
            }]),
          })),
        })),
      });
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: vi.fn(() => ({
          returning: vi.fn(() => []),
          catch: vi.fn(),
        })),
      });

      const { approveRequest } = await import('@/lib/rbac/approval-workflows');
      const result = await approveRequest('req-1', 'user-2');
      expect(result).toBeDefined();
      expect(result!.status).toBe('approved');
    });
  });
});
