import { describe, it, expect } from 'vitest';
import * as schema from '../../drizzle/schema';
import * as utils from '../../drizzle/schema/utils';

const TABLE_NAMES = [
  'tenants', 'users', 'refreshTokens', 'passwordResets', 'tenantMembers',
  'roles', 'sessions', 'impersonationSessions', 'fieldPermissions',
  'recordPermissions', 'apiKeys', 'apiKeyUsage', 'auditLogs', 'notifications',
  'invitations', 'featureRegistry', 'systemSettings', 'plans', 'subscriptions',
  'companies', 'contacts', 'leads', 'pipelines', 'pipelineStages', 'deals',
  'dealStages', 'tasks', 'customFields', 'customFieldDefs', 'tags',
  'emailTemplates', 'emailTracking', 'emailLog',
  'automations', 'automationRuns', 'webhooks', 'webhookDeliveries',
  'workflows', 'workflowActions', 'workflowExecutions',
  'activities', 'tenantBackups', 'backupRecords',
  'platformSettings', 'sequences', 'sequenceSteps', 'forms', 'formSubmissions',
  'supportTickets', 'ticketReplies', 'tokenBudgets',
  'modules', 'segments',
];

describe('Drizzle Schema - Table Exports', () => {
  it('all required tables are accessible from schema index', () => {
    for (const name of TABLE_NAMES) {
      expect((schema as any)[name]).toBeDefined();
    }
  });
});

describe('Drizzle Schema - Core Tables', () => {
  it('tenants table has expected columns', () => {
    const t = schema.tenants;
    expect(t.id).toBeDefined();
    expect(t.name).toBeDefined();
    expect(t.slug).toBeDefined();
    expect(t.createdAt).toBeDefined();
    expect(t.updatedAt).toBeDefined();
  });

  it('users table has columns', () => {
    const t = schema.users;
    expect(t.id).toBeDefined();
    expect(t.email).toBeDefined();
    expect(t.passwordHash).toBeDefined();
    expect(t.fullName).toBeDefined();
    expect(t.isSuperAdmin).toBeDefined();
  });

  it('tenantMembers has tenant and user references', () => {
    expect(schema.tenantMembers.tenantId).toBeDefined();
    expect(schema.tenantMembers.userId).toBeDefined();
  });

  it('auditLogs table has required columns', () => {
    expect(schema.auditLogs.tenantId).toBeDefined();
    expect(schema.auditLogs.action).toBeDefined();
    expect(schema.auditLogs.entityType).toBeDefined();
  });
});

describe('Drizzle Schema - CRM Tables', () => {
  it('companies table has columns', () => {
    const t = schema.companies;
    expect(t.id).toBeDefined();
    expect(t.tenantId).toBeDefined();
    expect(t.name).toBeDefined();
  });

  it('contacts table has columns', () => {
    const t = schema.contacts;
    expect(t.id).toBeDefined();
    expect(t.tenantId).toBeDefined();
    expect(t.firstName).toBeDefined();
    expect(t.email).toBeDefined();
  });

  it('deals table has columns', () => {
    const t = schema.deals;
    expect(t.id).toBeDefined();
    expect(t.tenantId).toBeDefined();
    expect(t.title).toBeDefined();
  });
});

describe('Drizzle Schema - Relationships', () => {
  it('tenantMembers references tenants and users', () => {
    expect(schema.tenantMembers.tenantId).toBeDefined();
    expect(schema.tenantMembers.userId).toBeDefined();
  });

  it('contacts references companies', () => {
    expect(schema.contacts.companyId).toBeDefined();
  });

  it('deals references pipelines and stages', () => {
    expect(schema.deals.pipelineId).toBeDefined();
    expect(schema.deals.stageId).toBeDefined();
  });

  it('tasks has assignedTo', () => {
    expect(schema.tasks.assignedTo).toBeDefined();
  });
});

describe('Drizzle Schema - Tenant Isolation', () => {
  it('all tenant-scoped tables have tenantId', () => {
    const tables = [
      schema.tenantMembers, schema.roles, schema.contacts, schema.leads,
      schema.companies, schema.deals, schema.pipelines, schema.tasks,
      schema.customFields, schema.emailTemplates, schema.automations,
      schema.workflows, schema.activities, schema.tenantBackups,
      schema.sequences, schema.forms,
      schema.supportTickets, schema.apiKeys, schema.auditLogs,
      schema.notifications, schema.invitations,
    ];
    tables.forEach(t => expect(t.tenantId).toBeDefined());
  });
});

describe('Drizzle Schema - Utilities', () => {
  it('schema utilities are exported', () => {
    expect(utils.pk).toBeDefined();
    expect(utils.tenantId).toBeDefined();
    expect(utils.lifecycle).toBeDefined();
  });
});
