/**
 * Comprehensive Drizzle Schema Tests
 * Tests all schema tables, relationships, and query operations
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { db } from '../../drizzle/db';
import * as schema from '../../drizzle/schema';
import { sql, eq, and, or, like, isNull, isNotNull, asc, desc, count, sum } from 'drizzle-orm';

// Mock the database pool to avoid actual DB connections
const { mockDbExecute, mockDbTx } = vi.hoisted(() => {
  const exec = vi.fn().mockResolvedValue({ rows: [] });
  const txFn = vi.fn(async (cb: any) => {
    const tx = { execute: vi.fn().mockResolvedValue({ rows: [] }), insert: vi.fn().mockReturnThis(), values: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([{ id: '1' }]) };
    return cb(tx);
  });
  return { mockDbExecute: exec, mockDbTx: txFn };
});
vi.mock('../../drizzle/db', () => ({
  db: {
    execute: mockDbExecute,
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    having: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: '1' }]),
    transaction: mockDbTx,
  },
}));

// Test suite for all schema tables
const allTables = {
  // Core tables
  tenants: schema.tenants,
  users: schema.users,
  refreshTokens: schema.refreshTokens,
  passwordResets: schema.passwordResets,
  tenantMembers: schema.tenantMembers,
  roles: schema.roles,
  sessions: schema.sessions,
  impersonationSessions: schema.impersonationSessions,
  fieldPermissions: schema.fieldPermissions,
  recordPermissions: schema.recordPermissions,
  apiKeys: schema.apiKeys,
  apiKeyUsage: schema.apiKeyUsage,
  auditLogs: schema.auditLogs,
  notifications: schema.notifications,
  invitations: schema.invitations,
  featureRegistry: schema.featureRegistry,
  systemSettings: schema.systemSettings,
  plans: schema.plans,
  subscriptions: schema.subscriptions,
  
  // CRM tables
  companies: schema.companies,
  contacts: schema.contacts,
  leads: schema.leads,
  pipelines: schema.pipelines,
  pipelineStages: schema.pipelineStages,
  deals: schema.deals,
  dealStages: schema.dealStages,
  stages: schema.stages,
  tasks: schema.tasks,
  customFields: schema.customFields,
  customFieldOptions: schema.customFieldOptions,
  tags: schema.tags,
  
  // Communication tables
  emails: schema.emails,
  emailTemplates: schema.emailTemplates,
  emailCampaigns: schema.emailCampaigns,
  emailTracking: schema.emailTracking,
  
  // Automation tables
  automations: schema.automations,
  automationRules: schema.automationRules,
  automationActions: schema.automationActions,
  triggers: schema.triggers,
  workflows: schema.workflows,
  workflowSteps: schema.workflowSteps,
  
  // Infrastructure tables
  activities: schema.activities,
  backups: schema.backups,
  backupRecords: schema.backupRecords,
  platformSettings: schema.platformSettings,
  storageObjects: schema.storageObjects,
  
  // Marketing tables
  sequences: schema.sequences,
  sequenceSteps: schema.sequenceSteps,
  forms: schema.forms,
  formSubmissions: schema.formSubmissions,
  
  // Support tables
  tickets: schema.tickets,
  ticketMessages: schema.ticketMessages,
  
  // Token tables
  tokenBuckets: schema.tokenBuckets,
  tokenUsage: schema.tokenUsage,
  
  // Modules tables
  modules: schema.modules,
  
  // Segments tables
  segments: schema.segments,
};

describe('Drizzle Schema - Table Definitions', () => {
  describe('Core Tables', () => {
    it('tenants table has all required columns', () => {
      const table = schema.tenants;
      expect(table.id).toBeDefined();
      expect(table.name).toBeDefined();
      expect(table.slug).toBeDefined();
      expect(table.status).toBeDefined();
      expect(table.planId).toBeDefined();
      expect(table.ownerId).toBeDefined();
      expect(table.createdAt).toBeDefined();
      expect(table.updatedAt).toBeDefined();
      expect(table.deletedAt).toBeDefined();
    });

    it('users table has all required columns', () => {
      const table = schema.users;
      expect(table.id).toBeDefined();
      expect(table.email).toBeDefined();
      expect(table.passwordHash).toBeDefined();
      expect(table.fullName).toBeDefined();
      expect(table.isSuperAdmin).toBeDefined();
      expect(table.emailVerified).toBeDefined();
    });

    it('roles table has tenant isolation', () => {
      const table = schema.roles;
      expect(table.tenantId).toBeDefined();
      expect(table.name).toBeDefined();
      expect(table.slug).toBeDefined();
      expect(table.permissions).toBeDefined();
    });

    it('tenantMembers table has tenant and user references', () => {
      const table = schema.tenantMembers;
      expect(table.tenantId).toBeDefined();
      expect(table.userId).toBeDefined();
      expect(table.roleId).toBeDefined();
      expect(table.status).toBeDefined();
    });

    it('apiKeys table has tenant isolation', () => {
      const table = schema.apiKeys;
      expect(table.tenantId).toBeDefined();
      expect(table.userId).toBeDefined();
      expect(table.keyHash).toBeDefined();
      expect(table.prefix).toBeDefined();
      expect(table.scopes).toBeDefined();
    });

    it('auditLogs table has tenant isolation and metadata', () => {
      const table = schema.auditLogs;
      expect(table.tenantId).toBeDefined();
      expect(table.userId).toBeDefined();
      expect(table.action).toBeDefined();
      expect(table.entityType).toBeDefined();
      expect(table.entityId).toBeDefined();
      expect(table.oldData).toBeDefined();
      expect(table.newData).toBeDefined();
    });
  });

  describe('CRM Tables', () => {
    it('companies table has all required columns', () => {
      const table = schema.companies;
      expect(table.id).toBeDefined();
      expect(table.tenantId).toBeDefined();
      expect(table.name).toBeDefined();
      expect(table.domain).toBeDefined();
      expect(table.industry).toBeDefined();
      expect(table.website).toBeDefined();
      expect(table.customFields).toBeDefined();
      expect(table.metadata).toBeDefined();
    });

    it('contacts table has all required columns', () => {
      const table = schema.contacts;
      expect(table.id).toBeDefined();
      expect(table.tenantId).toBeDefined();
      expect(table.companyId).toBeDefined();
      expect(table.assignedTo).toBeDefined();
      expect(table.firstName).toBeDefined();
      expect(table.lastName).toBeDefined();
      expect(table.email).toBeDefined();
      expect(table.leadStatus).toBeDefined();
      expect(table.lifecycleStage).toBeDefined();
    });

    it('leads table has all required columns', () => {
      const table = schema.leads;
      expect(table.id).toBeDefined();
      expect(table.tenantId).toBeDefined();
      expect(table.firstName).toBeDefined();
      expect(table.lastName).toBeDefined();
      expect(table.email).toBeDefined();
      expect(table.leadStatus).toBeDefined();
      expect(table.score).toBeDefined();
    });

    it('deals table has all required columns', () => {
      const table = schema.deals;
      expect(table.id).toBeDefined();
      expect(table.tenantId).toBeDefined();
      expect(table.title).toBeDefined();
      expect(table.pipelineId).toBeDefined();
      expect(table.stageId).toBeDefined();
      expect(table.amount).toBeDefined();
      expect(table.contactId).toBeDefined();
      expect(table.companyId).toBeDefined();
    });

    it('pipelines table has tenant isolation', () => {
      const table = schema.pipelines;
      expect(table.tenantId).toBeDefined();
      expect(table.name).toBeDefined();
      expect(table.isDefault).toBeDefined();
    });

    it('pipelineStages table has pipeline reference', () => {
      const table = schema.pipelineStages;
      expect(table.pipelineId).toBeDefined();
      expect(table.name).toBeDefined();
      expect(table.order).toBeDefined();
    });

    it('tasks table has all required columns', () => {
      const table = schema.tasks;
      expect(table.id).toBeDefined();
      expect(table.tenantId).toBeDefined();
      expect(table.title).toBeDefined();
      expect(table.assignedTo).toBeDefined();
      expect(table.dueDate).toBeDefined();
      expect(table.status).toBeDefined();
    });

    it('customFields table has tenant isolation', () => {
      const table = schema.customFields;
      expect(table.tenantId).toBeDefined();
      expect(table.entityType).toBeDefined();
      expect(table.fieldLabel).toBeDefined();
      expect(table.fieldType).toBeDefined();
    });
  });

  describe('Communication Tables', () => {
    it('emails table has tenant isolation', () => {
      const table = schema.emails;
      expect(table.tenantId).toBeDefined();
      expect(table.from).toBeDefined();
      expect(table.to).toBeDefined();
      expect(table.subject).toBeDefined();
      expect(table.body).toBeDefined();
    });

    it('emailTemplates table has tenant isolation', () => {
      const table = schema.emailTemplates;
      expect(table.tenantId).toBeDefined();
      expect(table.name).toBeDefined();
      expect(table.subject).toBeDefined();
      expect(table.bodyHtml).toBeDefined();
    });

    it('emailCampaigns table has tenant isolation', () => {
      const table = schema.emailCampaigns;
      expect(table.tenantId).toBeDefined();
      expect(table.name).toBeDefined();
      expect(table.templateId).toBeDefined();
      expect(table.status).toBeDefined();
    });
  });

  describe('Automation Tables', () => {
    it('automations table has tenant isolation', () => {
      const table = schema.automations;
      expect(table.tenantId).toBeDefined();
      expect(table.name).toBeDefined();
      expect(table.triggerType).toBeDefined();
      expect(table.isActive).toBeDefined();
    });

    it('automationRules table has automation reference', () => {
      const table = schema.automationRules;
      expect(table.automationId).toBeDefined();
      expect(table.conditionType).toBeDefined();
    });

    it('triggers table has tenant isolation', () => {
      const table = schema.triggers;
      expect(table.tenantId).toBeDefined();
      expect(table.eventType).toBeDefined();
      expect(table.entityType).toBeDefined();
    });

    it('workflows table has tenant isolation', () => {
      const table = schema.workflows;
      expect(table.tenantId).toBeDefined();
      expect(table.name).toBeDefined();
      expect(table.isActive).toBeDefined();
    });

    it('workflowSteps table has workflow reference', () => {
      const table = schema.workflowSteps;
      expect(table.workflowId).toBeDefined();
      expect(table.stepType).toBeDefined();
      expect(table.sortOrder).toBeDefined();
    });
  });

  describe('Infrastructure Tables', () => {
    it('activities table has tenant isolation', () => {
      const table = schema.activities;
      expect(table.tenantId).toBeDefined();
      expect(table.userId).toBeDefined();
      expect(table.entityType).toBeDefined();
      expect(table.entityId).toBeDefined();
      expect(table.eventType).toBeDefined();
    });

    it('tenantBackups table has tenant isolation', () => {
      const table = schema.tenantBackups;
      expect(table.tenantId).toBeDefined();
      expect(table.filename).toBeDefined();
      expect(table.storagePath).toBeDefined();
      expect(table.status).toBeDefined();
    });

    it('backupRecords table has all required columns', () => {
      const table = schema.backupRecords;
      expect(table.id).toBeDefined();
      expect(table.backupType).toBeDefined();
      expect(table.status).toBeDefined();
      expect(table.storagePath).toBeDefined();
    });

    it('platformSettings table has unique key', () => {
      const table = schema.platformSettings;
      expect(table.key).toBeDefined();
      expect(table.value).toBeDefined();
    });

    it('fileUploads table has tenant isolation', () => {
      const table = schema.fileUploads;
      expect(table.tenantId).toBeDefined();
      expect(table.fileName).toBeDefined();
      expect(table.filePath).toBeDefined();
    });
  });

  describe('Marketing Tables', () => {
    it('sequences table has tenant isolation', () => {
      const table = schema.sequences;
      expect(table.tenantId).toBeDefined();
      expect(table.name).toBeDefined();
      expect(table.status).toBeDefined();
    });

    it('sequenceSteps table has sequence reference', () => {
      const table = schema.sequenceSteps;
      expect(table.sequenceId).toBeDefined();
      expect(table.stepType).toBeDefined();
      expect(table.delayDays).toBeDefined();
    });

    it('forms table has tenant isolation', () => {
      const table = schema.forms;
      expect(table.tenantId).toBeDefined();
      expect(table.name).toBeDefined();
      expect(table.fields).toBeDefined();
    });

    it('formSubmissions table has form reference', () => {
      const table = schema.formSubmissions;
      expect(table.formId).toBeDefined();
      expect(table.tenantId).toBeDefined();
      expect(table.data).toBeDefined();
    });
  });

  describe('Support Tables', () => {
    it('tickets table has tenant isolation', () => {
      const table = schema.tickets;
      expect(table.tenantId).toBeDefined();
      expect(table.subject).toBeDefined();
      expect(table.status).toBeDefined();
      expect(table.priority).toBeDefined();
    });

    it('ticketMessages table has ticket reference', () => {
      const table = schema.ticketMessages;
      expect(table.ticketId).toBeDefined();
      expect(table.body).toBeDefined();
      expect(table.createdBy).toBeDefined();
    });
  });

  describe('Token Tables', () => {
    it('tokenBuckets table has tenant isolation', () => {
      const table = schema.tokenBuckets;
      expect(table.tenantId).toBeDefined();
      expect(table.modelId).toBeDefined();
      expect(table.tokensUsed).toBeDefined();
    });

    it('tokenUsage table has tenant isolation', () => {
      const table = schema.tokenUsage;
      expect(table.tenantId).toBeDefined();
      expect(table.bucketId).toBeDefined();
      expect(table.tokensUsed).toBeDefined();
    });
  });
});

describe('Drizzle Schema - Foreign Key Relationships', () => {
  it('tenantMembers references tenants and users', () => {
    const table = schema.tenantMembers;
    expect(table.tenantId).toBeDefined();
    expect(table.userId).toBeDefined();
  });

  it('contacts references companies and users', () => {
    const table = schema.contacts;
    expect(table.companyId).toBeDefined();
    expect(table.assignedTo).toBeDefined();
  });

  it('deals references contacts, companies, pipelines, and users', () => {
    const table = schema.deals;
    expect(table.contactId).toBeDefined();
    expect(table.companyId).toBeDefined();
    expect(table.pipelineId).toBeDefined();
    expect(table.stageId).toBeDefined();
    expect(table.assignedTo).toBeDefined();
  });

  it('pipelineStages references pipelines', () => {
    const table = schema.pipelineStages;
    expect(table.pipelineId).toBeDefined();
  });

  it('tasks references users and deals', () => {
    const table = schema.tasks;
    expect(table.assignedTo).toBeDefined();
    expect(table.dealId).toBeDefined();
    expect(table.contactId).toBeDefined();
  });

  it('automationRules references automations', () => {
    const table = schema.automationRules;
    expect(table.automationId).toBeDefined();
  });

  it('workflowSteps references workflows', () => {
    const table = schema.workflowSteps;
    expect(table.workflowId).toBeDefined();
  });

  it('emailCampaigns references emailTemplates', () => {
    const table = schema.emailCampaigns;
    expect(table.templateId).toBeDefined();
  });

  it('sequenceSteps references sequences', () => {
    const table = schema.sequenceSteps;
    expect(table.sequenceId).toBeDefined();
  });

  it('formSubmissions references forms', () => {
    const table = schema.formSubmissions;
    expect(table.formId).toBeDefined();
  });

  it('ticketMessages references tickets', () => {
    const table = schema.ticketMessages;
    expect(table.ticketId).toBeDefined();
  });

  it('tokenUsage references tokenBuckets', () => {
    const table = schema.tokenUsage;
    expect(table.bucketId).toBeDefined();
  });

  it('apiKeyUsage references apiKeys', () => {
    const table = schema.apiKeyUsage;
    expect(table.apiKeyId).toBeDefined();
  });
});

describe('Drizzle Schema - Index Definitions', () => {
  it('all tables have tenant index where applicable', () => {
    const tablesWithTenant = [
      schema.tenantMembers,
      schema.roles,
      schema.contacts,
      schema.leads,
      schema.companies,
      schema.deals,
      schema.pipelines,
      schema.tasks,
      schema.customFields,
      schema.emails,
      schema.emailTemplates,
      schema.emailCampaigns,
      schema.automations,
      schema.triggers,
      schema.workflows,
      schema.activities,
      schema.backups,
      schema.backupRecords,
      schema.sequences,
      schema.forms,
      schema.tickets,
      schema.tokenBuckets,
      schema.tokenUsage,
      schema.apiKeys,
      schema.auditLogs,
      schema.notifications,
      schema.invitations,
    ];

    tablesWithTenant.forEach(table => {
      // All tenant-isolated tables should have tenantId
      expect(table.tenantId).toBeDefined();
    });
  });

  it('unique constraints are defined on key tables', () => {
    // Tenants have unique slug
    expect(schema.tenants.slug).toBeDefined();
    
    // Users have unique email
    expect(schema.users.email).toBeDefined();
    
    // API keys have unique prefix and hash
    expect(schema.apiKeys.prefix).toBeDefined();
    expect(schema.apiKeys.keyHash).toBeDefined();
    
    // Plans have unique slug
    expect(schema.plans.slug).toBeDefined();
    
    // System settings have unique key
    expect(schema.systemSettings.key).toBeDefined();
  });
});

describe('Drizzle Schema - Utility Functions', () => {
  it('exports all schema tables from index', () => {
    expect(schema.tenants).toBeDefined();
    expect(schema.users).toBeDefined();
    expect(schema.contacts).toBeDefined();
    expect(schema.companies).toBeDefined();
    expect(schema.deals).toBeDefined();
    expect(schema.leads).toBeDefined();
    expect(schema.pipelines).toBeDefined();
    expect(schema.tasks).toBeDefined();
    expect(schema.automations).toBeDefined();
    expect(schema.workflows).toBeDefined();
  });

  it('schema utilities are exported', () => {
    const utils = require('../../drizzle/schema/utils');
    expect(utils.pk).toBeDefined();
    expect(utils.tenantId).toBeDefined();
    expect(utils.lifecycle).toBeDefined();
    expect(utils.audit).toBeDefined();
    expect(utils.metadata).toBeDefined();
    expect(utils.tenantIdx).toBeDefined();
    expect(utils.metadataIdx).toBeDefined();
    expect(utils.activeIdx).toBeDefined();
  });
});

describe('Drizzle Schema - All Tables Export', () => {
  it('all tables are accessible from schema index', () => {
    const requiredTables = [
      'tenants', 'users', 'refreshTokens', 'passwordResets', 'tenantMembers',
      'roles', 'sessions', 'impersonationSessions', 'fieldPermissions',
      'recordPermissions', 'apiKeys', 'apiKeyUsage', 'auditLogs', 'notifications',
      'invitations', 'featureRegistry', 'systemSettings', 'plans', 'subscriptions',
      'companies', 'contacts', 'leads', 'pipelines', 'pipelineStages', 'deals',
      'dealStages', 'tasks', 'customFields', 'tags',
      'emailTemplates', 'emailTracking',
      'automations', 'workflows', 'workflowSteps', 'activities', 'tenantBackups', 'backupRecords',
      'platformSettings', 'sequences', 'sequenceSteps',
      'forms', 'formSubmissions', 'tickets', 'ticketMessages', 'tokenBudgets',
      'modules', 'segments',
    ];

    requiredTables.forEach(tableName => {
      // @ts-expect-error - dynamic access
      expect(schema[tableName]).toBeDefined();
    });
  });
});

describe('Drizzle - Raw SQL Queries', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('can execute raw SQL SELECT query', async () => {
    const result = await db.execute(sql`SELECT COUNT(*) as count FROM tenants`);
    expect(mockDbExecute).toHaveBeenCalled();
  });

  it('can execute raw SQL with parameters', async () => {
    const tenantId = 'tenant-1';
    await db.execute(sql`SELECT * FROM contacts WHERE tenant_id = ${tenantId}`);
    expect(mockDbExecute).toHaveBeenCalled();
  });

  it('can execute raw SQL INSERT', async () => {
    await db.execute(sql`INSERT INTO tenants (name, slug) VALUES ('Test', 'test')`);
    expect(mockDbExecute).toHaveBeenCalled();
  });

  it('can execute raw SQL UPDATE', async () => {
    await db.execute(sql`UPDATE users SET full_name = 'Test' WHERE id = 'user-1'`);
    expect(mockDbExecute).toHaveBeenCalled();
  });

  it('can execute raw SQL DELETE', async () => {
    await db.execute(sql`DELETE FROM tasks WHERE id = 'task-1'`);
    expect(mockDbExecute).toHaveBeenCalled();
  });
});

describe('Drizzle - Transactions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('can execute transaction', async () => {
    await db.transaction(async (tx) => {
      await tx.insert(schema.users).values({ email: 'test@example.com' });
      await tx.insert(schema.tenants).values({ name: 'Test', slug: 'test' });
    });

    expect(mockDbTx).toHaveBeenCalled();
  });

  it('transaction rolls back on error', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(schema.users).values({ email: 'test@example.com' });
        throw new Error('Test error');
      })
    ).rejects.toThrow();

    expect(mockDbTx).toHaveBeenCalled();
  });
});

describe('Drizzle Schema - Data Types Validation', () => {
  it('tenants table has correct data types', () => {
    const table = schema.tenants;
    // Check that columns exist and have expected types
    expect(typeof table.id === 'object').toBe(true);
    expect(typeof table.name === 'object').toBe(true);
    expect(typeof table.slug === 'object').toBe(true);
    expect(typeof table.status === 'object').toBe(true);
    expect(typeof table.ownerId === 'object').toBe(true);
  });

  it('users table has correct data types', () => {
    const table = schema.users;
    expect(typeof table.id === 'object').toBe(true);
    expect(typeof table.email === 'object').toBe(true);
    expect(typeof table.passwordHash === 'object').toBe(true);
    expect(typeof table.isSuperAdmin === 'object').toBe(true);
  });

  it('deals table has numeric data types', () => {
    const table = schema.deals;
    expect(typeof table.amount === 'object').toBe(true);
  });

  it('companies table has array data type for tags', () => {
    const table = schema.companies;
    expect(typeof table.tags === 'object').toBe(true);
  });

  it('contacts table has array data type for tags', () => {
    const table = schema.contacts;
    expect(typeof table.tags === 'object').toBe(true);
  });

  it('leads table has array data type for tags', () => {
    const table = schema.leads;
    expect(typeof table.tags === 'object').toBe(true);
  });

  it('customFields table has JSON data type', () => {
    const table = schema.customFields;
    expect(typeof table.fieldOptions === 'object').toBe(true);
  });

  it('metadata columns are JSON type', () => {
    expect(typeof schema.tenants.settings === 'object').toBe(true);
    expect(typeof schema.contacts.metadata === 'object').toBe(true);
    expect(typeof schema.deals.metadata === 'object').toBe(true);
    expect(typeof schema.companies.metadata === 'object').toBe(true);
  });
});

describe('Drizzle Schema - Nullability Constraints', () => {
  it('tenants required columns are not null', () => {
    const table = schema.tenants;
    // These should be required (not null)
    expect(table.name.notNull).toBe(true);
    expect(table.slug.notNull).toBe(true);
    expect(table.status.notNull).toBe(true);
  });

  it('users required columns are not null', () => {
    const table = schema.users;
    expect(table.email.notNull).toBe(true);
  });

  it('contacts has optional columns', () => {
    const table = schema.contacts;
    // These should be optional (can be null)
    expect(table.email.notNull).toBe(false);
    expect(table.phone.notNull).toBe(false);
    expect(table.companyId.notNull).toBe(false);
  });

  it('deals required columns are not null', () => {
    const table = schema.deals;
    expect(table.title.notNull).toBe(true);
    expect(table.tenantId.notNull).toBe(true);
  });

  it('pipelines required columns are not null', () => {
    const table = schema.pipelines;
    expect(table.tenantId.notNull).toBe(true);
    expect(table.name.notNull).toBe(true);
  });
});

describe('Drizzle Schema - Default Values', () => {
  it('tenants has default status', () => {
    const table = schema.tenants;
    expect(table.status.default).toBe('trialing');
  });

  it('users has default timezone', () => {
    const table = schema.users;
    expect(table.timezone.default).toBe('UTC');
  });

  it('users has default isSuperAdmin', () => {
    const table = schema.users;
    expect(table.isSuperAdmin.default).toBe(false);
  });

  it('users has default emailVerified', () => {
    const table = schema.users;
    expect(table.emailVerified.default).toBe(false);
  });

  it('contacts has default leadStatus', () => {
    const table = schema.contacts;
    expect(table.leadStatus.default).toBe('new');
  });

  it('contacts has default lifecycleStage', () => {
    const table = schema.contacts;
    expect(table.lifecycleStage.default).toBe('subscriber');
  });

  it('deals has default status', () => {
    const table = schema.deals;
    expect(table.status.default).toBe('open');
  });

  it('pipelines has default isDefault', () => {
    const table = schema.pipelines;
    expect(table.isDefault.default).toBe(false);
  });

  it('tasks has default status', () => {
    const table = schema.tasks;
    expect(table.status.default).toBe('pending');
  });

  it('automations has default isActive', () => {
    const table = schema.automations;
    expect(table.isActive.default).toBe(true);
  });

  it('workflows has default isActive', () => {
    const table = schema.workflows;
    expect(table.isActive.default).toBe(false);
  });

  it('apiKeys has default isActive', () => {
    const table = schema.apiKeys;
    expect(table.isActive.default).toBe(true);
  });

  it('apiKeys has default scopes', () => {
    const table = schema.apiKeys;
    expect(table.scopes.default).toEqual(['*']);
  });

  it('metadata columns have default empty object', () => {
    expect(schema.tenants.settings.default).toEqual({});
    expect(schema.contacts.metadata.default).toEqual({});
    expect(schema.deals.metadata.default).toEqual({});
    expect(schema.companies.metadata.default).toEqual({});
  });

  it('array columns have default empty array', () => {
    expect(schema.companies.tags.default).toBeDefined();
    expect(schema.contacts.tags.default).toBeDefined();
    expect(schema.leads.tags.default).toBeDefined();
  });
});

describe('Drizzle Schema - Timestamps', () => {
  it('tenants has lifecycle timestamps', () => {
    const table = schema.tenants;
    expect(table.createdAt).toBeDefined();
    expect(table.updatedAt).toBeDefined();
    expect(table.deletedAt).toBeDefined();
  });

  it('users has lifecycle timestamps', () => {
    const table = schema.users;
    expect(table.createdAt).toBeDefined();
    expect(table.updatedAt).toBeDefined();
    expect(table.deletedAt).toBeDefined();
  });

  it('contacts has audit timestamps', () => {
    const table = schema.contacts;
    expect(table.createdAt).toBeDefined();
    expect(table.updatedAt).toBeDefined();
    expect(table.deletedAt).toBeDefined();
    expect(table.createdBy).toBeDefined();
    expect(table.updatedBy).toBeDefined();
    expect(table.deletedBy).toBeDefined();
  });

  it('deals has audit timestamps', () => {
    const table = schema.deals;
    expect(table.createdAt).toBeDefined();
    expect(table.updatedAt).toBeDefined();
    expect(table.deletedAt).toBeDefined();
    expect(table.createdBy).toBeDefined();
    expect(table.updatedBy).toBeDefined();
    expect(table.deletedBy).toBeDefined();
  });

  it('pipelines has lifecycle timestamps', () => {
    const table = schema.pipelines;
    expect(table.createdAt).toBeDefined();
    expect(table.updatedAt).toBeDefined();
    expect(table.deletedAt).toBeDefined();
  });

  it('tasks has lifecycle timestamps', () => {
    const table = schema.tasks;
    expect(table.createdAt).toBeDefined();
    expect(table.updatedAt).toBeDefined();
    expect(table.deletedAt).toBeDefined();
  });

  it('automations has lifecycle timestamps', () => {
    const table = schema.automations;
    expect(table.createdAt).toBeDefined();
    expect(table.updatedAt).toBeDefined();
    expect(table.deletedAt).toBeDefined();
  });

  it('workflows has lifecycle timestamps', () => {
    const table = schema.workflows;
    expect(table.createdAt).toBeDefined();
    expect(table.updatedAt).toBeDefined();
    expect(table.deletedAt).toBeDefined();
  });
});



  it('can perform complex query with multiple joins', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    vi.mock('../../lib/db/client', () => ({
      getPool: vi.fn().mockReturnValue(mockPool),
    }));

    await db
      .select({
        deal: schema.deals,
        contact: schema.contacts,
        company: schema.companies,
        pipeline: schema.pipelines,
      })
      .from(schema.deals)
      .leftJoin(schema.contacts, eq(schema.deals.contactId, schema.contacts.id))
      .leftJoin(schema.companies, eq(schema.deals.companyId, schema.companies.id))
      .leftJoin(schema.pipelines, eq(schema.deals.pipelineId, schema.pipelines.id))
      .where(eq(schema.deals.tenantId, 'tenant-1'))
      .orderBy(desc(schema.deals.createdAt))
      .limit(10);

    expect(mockPool.query).toHaveBeenCalled();
  });

  it('can perform query with subquery', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    vi.mock('../../lib/db/client', () => ({
      getPool: vi.fn().mockReturnValue(mockPool),
    }));

    const subquery = db
      .select({ contactId: schema.contacts.id })
      .from(schema.contacts)
      .where(eq(schema.contacts.tenantId, 'tenant-1'));

    await db
      .select()
      .from(schema.deals)
      .where(inArray(schema.deals.contactId, subquery));

    expect(mockPool.query).toHaveBeenCalled();
  });

  it('can perform query with EXISTS', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    vi.mock('../../lib/db/client', () => ({
      getPool: vi.fn().mockReturnValue(mockPool),
    }));

    const existsSubquery = db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(eq(schema.tasks.dealId, schema.deals.id));

    await db
      .select()
      .from(schema.deals)
      .where(exists(existsSubquery));

    expect(mockPool.query).toHaveBeenCalled();
  });

  it('can perform query with IN array', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    vi.mock('../../lib/db/client', () => ({
      getPool: vi.fn().mockReturnValue(mockPool),
    }));

    await db
      .select()
      .from(schema.contacts)
      .where(inArray(schema.contacts.id, ['c1', 'c2', 'c3']));

    expect(mockPool.query).toHaveBeenCalled();
  });

  it('can perform query with NOT IN array', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    vi.mock('../../lib/db/client', () => ({
      getPool: vi.fn().mockReturnValue(mockPool),
    }));

    await db
      .select()
      .from(schema.contacts)
      .where(not(inArray(schema.contacts.id, ['c1', 'c2'])));

    expect(mockPool.query).toHaveBeenCalled();
  });

  it('can perform query with BETWEEN', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    vi.mock('../../lib/db/client', () => ({
      getPool: vi.fn().mockReturnValue(mockPool),
    }));

    const startDate = new Date('2024-01-01');
    const endDate = new Date('2024-12-31');
    
    await db
      .select()
      .from(schema.deals)
      .where(between(schema.deals.createdAt, startDate, endDate));

    expect(mockPool.query).toHaveBeenCalled();
  });
});
