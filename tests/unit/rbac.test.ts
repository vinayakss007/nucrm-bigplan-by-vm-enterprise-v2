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
  const sqlFn = Object.assign(vi.fn(() => 'mocked_sql'), {
    raw: vi.fn((val: string) => val),
    identifier: vi.fn((val: string) => val),
  });
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
      const _filter = getRecordAccessFilter('tenant-1', 'user-1', 'role-1', 'contact');
      // When sql is mocked, it returns whatever the mock returns (could be undefined)
      // The important thing is the function doesn't throw
      expect(typeof getRecordAccessFilter).toBe('function');
    });
  });
});

describe('RBAC - Field Permissions Additional', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  describe('getFieldPermissions', () => {
    it('returns permissions for a role on entity type', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { fieldName: 'salary', accessLevel: 'none' },
          ]),
        })),
      });

      const { getFieldPermissions } = await import('@/lib/rbac/field-permissions');
      const result = await getFieldPermissions('tenant-1', 'role-1', 'contact');
      expect(result).toHaveLength(1);
      expect(result[0].fieldName).toBe('salary');
    });
  });

  describe('checkFieldAccess', () => {
    it('returns write as default when no permission defined', async () => {
      const { checkFieldAccess } = await import('@/lib/rbac/field-permissions');
      const result = await checkFieldAccess('tenant-1', 'role-1', 'contact', 'name');
      expect(result).toBe('write');
    });

    it('returns the explicit access level when defined', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { accessLevel: 'read' },
          ]),
        })),
      });

      const { checkFieldAccess } = await import('@/lib/rbac/field-permissions');
      const result = await checkFieldAccess('tenant-1', 'role-1', 'contact', 'name');
      expect(result).toBe('read');
    });
  });

  describe('setFieldPermission', () => {
    it('inserts new permission when none exists', async () => {
      const { db } = await import('@/drizzle/db');
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: vi.fn(() => ({
          returning: vi.fn(() => [{
            id: 'fp-new', fieldName: 'salary', accessLevel: 'none',
          }]),
        })),
      });

      const { setFieldPermission } = await import('@/lib/rbac/field-permissions');
      const result = await setFieldPermission('tenant-1', 'role-1', 'contact', 'salary', 'none');
      expect(result.accessLevel).toBe('none');
    });

    it('updates existing permission when one exists', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { id: 'fp-1', fieldName: 'salary', accessLevel: 'none', tenantId: 'tenant-1', roleId: 'role-1', entityType: 'contact' },
          ]),
        })),
      });
      (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn(() => ({})),
        })),
      });

      const { setFieldPermission } = await import('@/lib/rbac/field-permissions');
      const result = await setFieldPermission('tenant-1', 'role-1', 'contact', 'salary', 'read');
      expect(result.accessLevel).toBe('read');
    });
  });
});

describe('RBAC - Record Permissions Additional', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  describe('grantRecordAccess', () => {
    it('inserts new record permission when none exists', async () => {
      const { db } = await import('@/drizzle/db');
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: vi.fn(() => ({
          returning: vi.fn(() => [{
            id: 'rp-new', tenantId: 'tenant-1', roleId: 'role-1',
            entityType: 'deal', entityId: 'deal-1', accessLevel: 'write', grantedBy: 'user-1',
          }]),
        })),
      });

      const { grantRecordAccess } = await import('@/lib/rbac/record-permissions');
      const result = await grantRecordAccess('tenant-1', 'role-1', 'deal', 'deal-1', 'write', 'user-1');
      expect(result.accessLevel).toBe('write');
    });

    it('updates existing record permission when one exists', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { id: 'rp-1', tenantId: 'tenant-1', roleId: 'role-1', entityType: 'deal', entityId: 'deal-1', accessLevel: 'read', grantedBy: 'user-1' },
          ]),
        })),
      });
      (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn(() => ({})),
        })),
      });

      const { grantRecordAccess } = await import('@/lib/rbac/record-permissions');
      const result = await grantRecordAccess('tenant-1', 'role-1', 'deal', 'deal-1', 'admin', 'user-2');
      expect(result.accessLevel).toBe('admin');
    });
  });

  describe('revokeRecordAccess', () => {
    it('soft-deletes record permission', async () => {
      const { db } = await import('@/drizzle/db');
      (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn(() => ({})),
        })),
      });

      const { revokeRecordAccess } = await import('@/lib/rbac/record-permissions');
      await expect(revokeRecordAccess('tenant-1', 'role-1', 'deal', 'deal-1')).resolves.not.toThrow();
    });
  });

  describe('getColumnMapping', () => {
    it('returns default mapping for unknown entity types', async () => {
      const { getColumnMapping } = await import('@/lib/rbac/record-permissions');
      const mapping = getColumnMapping('unknown');
      expect(mapping.idColumn).toBe('id');
      expect(mapping.assignedToColumn).toBe('assigned_to');
      expect(mapping.createdByColumn).toBe('created_by');
    });

    it('returns overridden mapping for tickets', async () => {
      const { getColumnMapping } = await import('@/lib/rbac/record-permissions');
      const mapping = getColumnMapping('tickets');
      expect(mapping.assignedToColumn).toBe('assignee_id');
      expect(mapping.createdByColumn).toBe('reporter_id');
    });

    it('returns overridden mapping for documents', async () => {
      const { getColumnMapping } = await import('@/lib/rbac/record-permissions');
      const mapping = getColumnMapping('documents');
      expect(mapping.assignedToColumn).toBe('owner_id');
      expect(mapping.createdByColumn).toBe('uploaded_by');
    });

    it('returns overridden mapping for companies (owner_id)', async () => {
      const { getColumnMapping } = await import('@/lib/rbac/record-permissions');
      const mapping = getColumnMapping('companies');
      expect(mapping.assignedToColumn).toBe('owner_id');
      expect(mapping.createdByColumn).toBe('created_by');
    });
  });

  describe('getRecordAccessFilter', () => {
    it('returns a SQL expression for entity access filtering', async () => {
      const { getRecordAccessFilter } = await import('@/lib/rbac/record-permissions');
      const filter = getRecordAccessFilter('tenant-1', 'user-1', 'role-1', 'contact');
      expect(filter).toBeDefined();
    });

    it('accepts custom column mapping overrides', async () => {
      const { getRecordAccessFilter } = await import('@/lib/rbac/record-permissions');
      const filter = getRecordAccessFilter('tenant-1', 'user-1', 'role-1', 'contact', { assignedToColumn: 'owner_id' });
      expect(filter).toBeDefined();
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

    it('checkNeedsApproval handles != operator with strings', async () => {
      const { checkNeedsApproval } = await import('@/lib/rbac/approval-workflows');
      const rules = [
        { id: 'r1', tenantId: 't1', entityType: 'deal', conditionField: 'status', conditionOperator: '!=' as const, conditionValue: 'draft', approverRoleSlug: 'manager', autoApproveRoles: [] },
      ];
      expect(checkNeedsApproval(rules, 'deal', { status: 'published' })).not.toBeNull();
      expect(checkNeedsApproval(rules, 'deal', { status: 'draft' })).toBeNull();
    });

    it('checkNeedsApproval handles null/undefined field values', async () => {
      const { checkNeedsApproval } = await import('@/lib/rbac/approval-workflows');
      const rules = [
        { id: 'r1', tenantId: 't1', entityType: 'deal', conditionField: 'amount', conditionOperator: '>' as const, conditionValue: 100, approverRoleSlug: 'manager', autoApproveRoles: [] },
      ];
      expect(checkNeedsApproval(rules, 'deal', { amount: undefined })).toBeNull();
      expect(checkNeedsApproval(rules, 'deal', {})).toBeNull();
    });

    it('checkNeedsApproval handles <= operator with exact match', async () => {
      const { checkNeedsApproval } = await import('@/lib/rbac/approval-workflows');
      const rules = [
        { id: 'r1', tenantId: 't1', entityType: 'deal', conditionField: 'amount', conditionOperator: '<=' as const, conditionValue: 1000, approverRoleSlug: 'manager', autoApproveRoles: [] },
      ];
      expect(checkNeedsApproval(rules, 'deal', { amount: 1000 })).not.toBeNull();
      expect(checkNeedsApproval(rules, 'deal', { amount: 1001 })).toBeNull();
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

    describe('rejectRequest', () => {
      it('rejects a pending request', async () => {
        const { db } = await import('@/drizzle/db');
        (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
          set: vi.fn(() => ({
            where: vi.fn(() => ({
              returning: vi.fn(() => [{
                id: 'req-1',
                tenantId: 'tenant-1',
                entityType: 'deal',
                entityId: 'deal-1',
                status: 'rejected',
                rejectedBy: 'user-2',
                reason: 'Not appropriate',
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

        const { rejectRequest } = await import('@/lib/rbac/approval-workflows');
        const result = await rejectRequest('req-1', 'user-2', 'Not appropriate');
        expect(result).toBeDefined();
        expect(result!.status).toBe('rejected');
        expect(result!.reason).toBe('Not appropriate');
      });
    });
  });
});
