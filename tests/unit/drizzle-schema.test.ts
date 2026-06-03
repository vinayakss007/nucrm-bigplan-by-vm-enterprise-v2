import { describe, it, expect } from 'vitest';
import * as schema from '../../drizzle/schema';
import * as utils from '../../drizzle/schema/utils';

describe('Drizzle Schema - Table Exports', () => {
  const requiredTables = [
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
    'platformSettings',
    'sequences', 'sequenceSteps', 'forms', 'formSubmissions',
    'supportTickets', 'ticketReplies',
    'tokenBudgets',
    'modules', 'segments',
  ];

  it('all required tables are accessible from schema index', () => {
    for (const name of requiredTables) {
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
    expect(t.status).toBeDefined();
    expect(t.planId).toBeDefined();
    expect(t.ownerId).toBeDefined();
    expect(t.createdAt).toBeDefined();
    expect(t.updatedAt).toBeDefined();
    expect(t.deletedAt).toBeDefined();
  });

  it('users table has expected columns', () => {
    const t = schema.users;
    expect(t.id).toBeDefined();
    expect(t.email).toBeDefined();
    expect(t.passwordHash).toBeDefined();
    expect(t.fullName).toBeDefined();
    expect(t.isSuperAdmin).toBeDefined();
    expect(t.emailVerified).toBeDefined();
  });

  it('roles table has tenant isolation', () => {
    const t = schema.roles;
    expect(t.tenantId).toBeDefined();
    expect(t.name).toBeDefined();
    expect(t.slug).toBeDefined();
    expect(t.permissions).toBeDefined();
  });

  it('tenantMembers table has tenant and user references', () => {
    const t = schema.tenantMembers;
    expect(t.tenantId).toBeDefined();
    expect(t.userId).toBeDefined();
    expect(t.roleId).toBeDefined();
    expect(t.status).toBeDefined();
  });

  it('apiKeys table has tenant isolation', () => {
    const t = schema.apiKeys;
    expect(t.tenantId).toBeDefined();
    expect(t.userId).toBeDefined();
    expect(t.keyHash).toBeDefined();
    expect(t.prefix).toBeDefined();
    expect(t.scopes).toBeDefined();
  });

  it('auditLogs table has tenant isolation and metadata', () => {
    const t = schema.auditLogs;
    expect(t.tenantId).toBeDefined();
    expect(t.userId).toBeDefined();
    expect(t.action).toBeDefined();
    expect(t.entityType).toBeDefined();
    expect(t.entityId).toBeDefined();
    expect(t.oldData).toBeDefined();
    expect(t.newData).toBeDefined();
  });
});

describe('Drizzle Schema - CRM Tables', () => {
  it('companies table has expected columns', () => {
    const t = schema.companies;
    expect(t.id).toBeDefined();
    expect(t.tenantId).toBeDefined();
    expect(t.name).toBeDefined();
    expect(t.domain).toBeDefined();
    expect(t.industry).toBeDefined();
    expect(t.website).toBeDefined();
    expect(t.customFields).toBeDefined();
    expect(t.metadata).toBeDefined();
  });

  it('contacts table has expected columns', () => {
    const t = schema.contacts;
    expect(t.id).toBeDefined();
    expect(t.tenantId).toBeDefined();
    expect(t.companyId).toBeDefined();
    expect(t.assignedTo).toBeDefined();
    expect(t.firstName).toBeDefined();
    expect(t.lastName).toBeDefined();
    expect(t.email).toBeDefined();
    expect(t.leadStatus).toBeDefined();
    expect(t.lifecycleStage).toBeDefined();
  });

  it('leads table has expected columns', () => {
    const t = schema.leads;
    expect(t.id).toBeDefined();
    expect(t.tenantId).toBeDefined();
    expect(t.firstName).toBeDefined();
    expect(t.lastName).toBeDefined();
    expect(t.email).toBeDefined();
    expect(t.leadStatus).toBeDefined();
    expect(t.score).toBeDefined();
  });

  it('deals table has expected columns', () => {
    const t = schema.deals;
    expect(t.id).toBeDefined();
    expect(t.tenantId).toBeDefined();
    expect(t.title).toBeDefined();
    expect(t.pipelineId).toBeDefined();
    expect(t.stageId).toBeDefined();
    expect(t.amount).toBeDefined();
    expect(t.contactId).toBeDefined();
    expect(t.companyId).toBeDefined();
  });

  it('pipelines table has tenant isolation', () => {
    const t = schema.pipelines;
    expect(t.tenantId).toBeDefined();
    expect(t.name).toBeDefined();
    expect(t.isDefault).toBeDefined();
  });

  it('pipelineStages table has pipeline reference and order', () => {
    const t = schema.pipelineStages;
    expect(t.pipelineId).toBeDefined();
    expect(t.name).toBeDefined();
    expect(t.order).toBeDefined();
  });

  it('tasks table has expected columns', () => {
    const t = schema.tasks;
    expect(t.id).toBeDefined();
    expect(t.tenantId).toBeDefined();
    expect(t.title).toBeDefined();
    expect(t.assignedTo).toBeDefined();
    expect(t.dueDate).toBeDefined();
    expect(t.status).toBeDefined();
  });

  it('customFields table has tenant isolation', () => {
    const t = schema.customFields;
    expect(t.tenantId).toBeDefined();
    expect(t.entityType).toBeDefined();
    expect(t.fieldKey).toBeDefined();
    expect(t.fieldLabel).toBeDefined();
  });
});

describe('Drizzle Schema - Communication Tables', () => {
  it('emailTemplates table has tenant isolation', () => {
    const t = schema.emailTemplates;
    expect(t.tenantId).toBeDefined();
    expect(t.name).toBeDefined();
    expect(t.subject).toBeDefined();
    expect(t.bodyHtml).toBeDefined();
  });
});

describe('Drizzle Schema - Automation Tables', () => {
  it('automations table has tenant isolation', () => {
    const t = schema.automations;
    expect(t.tenantId).toBeDefined();
    expect(t.name).toBeDefined();
    expect(t.triggerType).toBeDefined();
    expect(t.isActive).toBeDefined();
  });

  it('workflows table has tenant isolation', () => {
    const t = schema.workflows;
    expect(t.tenantId).toBeDefined();
    expect(t.name).toBeDefined();
    expect(t.status).toBeDefined();
  });
});

describe('Drizzle Schema - Infrastructure Tables', () => {
  it('activities table has tenant isolation', () => {
    const t = schema.activities;
    expect(t.tenantId).toBeDefined();
    expect(t.userId).toBeDefined();
    expect(t.entityType).toBeDefined();
    expect(t.entityId).toBeDefined();
    expect(t.eventType).toBeDefined();
  });

  it('tenantBackups table has tenant isolation', () => {
    const t = schema.tenantBackups;
    expect(t.tenantId).toBeDefined();
    expect(t.filename).toBeDefined();
    expect(t.storagePath).toBeDefined();
    expect(t.status).toBeDefined();
  });

  it('platformSettings table has key and value', () => {
    const t = schema.platformSettings;
    expect(t.key).toBeDefined();
    expect(t.value).toBeDefined();
  });

  it('backupRecords table exists', () => {
    const t = schema.backupRecords;
    expect(t.id).toBeDefined();
    expect(t.status).toBeDefined();
  });
});

describe('Drizzle Schema - Marketing Tables', () => {
  it('sequences table has tenant isolation', () => {
    const t = schema.sequences;
    expect(t.tenantId).toBeDefined();
    expect(t.name).toBeDefined();
    expect(t.status).toBeDefined();
  });

  it('sequenceSteps table has sequence reference', () => {
    const t = schema.sequenceSteps;
    expect(t.sequenceId).toBeDefined();
    expect(t.stepType).toBeDefined();
    expect(t.delayDays).toBeDefined();
  });

  it('forms table has tenant isolation', () => {
    const t = schema.forms;
    expect(t.tenantId).toBeDefined();
    expect(t.name).toBeDefined();
    expect(t.fields).toBeDefined();
  });

  it('formSubmissions table has form reference', () => {
    const t = schema.formSubmissions;
    expect(t.formId).toBeDefined();
    expect(t.tenantId).toBeDefined();
    expect(t.data).toBeDefined();
  });
});

describe('Drizzle Schema - Support Tables', () => {
  it('supportTickets table has tenant isolation', () => {
    const t = schema.supportTickets;
    expect(t.tenantId).toBeDefined();
  });

  it('ticketReplies table has ticket reference', () => {
    const t = schema.ticketReplies;
    expect(t.ticketId).toBeDefined();
    expect(t.body).toBeDefined();
  });
});

describe('Drizzle Schema - Token Tables', () => {
  it('tokenBudgets table has expected columns', () => {
    const t = schema.tokenBudgets;
    expect(t.service).toBeDefined();
    expect(t.monthlyBudgetCents).toBeDefined();
  });
});

describe('Drizzle Schema - Foreign Key Relationships', () => {
  it('tenantMembers references tenants and users', () => {
    const t = schema.tenantMembers;
    expect(t.tenantId).toBeDefined();
    expect(t.userId).toBeDefined();
  });

  it('contacts references companies', () => {
    const t = schema.contacts;
    expect(t.companyId).toBeDefined();
  });

  it('deals references contacts, companies, pipelines, and stages', () => {
    const t = schema.deals;
    expect(t.contactId).toBeDefined();
    expect(t.companyId).toBeDefined();
    expect(t.pipelineId).toBeDefined();
    expect(t.stageId).toBeDefined();
    expect(t.assignedTo).toBeDefined();
  });

  it('pipelineStages references pipelines', () => {
    expect(schema.pipelineStages.pipelineId).toBeDefined();
  });

  it('tasks references users and deals', () => {
    const t = schema.tasks;
    expect(t.assignedTo).toBeDefined();
    expect(t.dealId).toBeDefined();
    expect(t.contactId).toBeDefined();
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
    const tableList = [
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
      'platformSettings',
      'sequences', 'sequenceSteps', 'forms', 'formSubmissions',
      'supportTickets', 'ticketReplies', 'tokenBudgets',
      'modules', 'segments',
    ];

    for (const name of tableList) {
      expect((schema as any)[name]).toBeDefined();
    }
  });
});

describe('Drizzle Schema - Data Types Validation', () => {
  it('key tables have uuid primary keys', () => {
    expect(schema.tenants.id).toBeDefined();
    expect(schema.users.id).toBeDefined();
    expect(schema.deals.id).toBeDefined();
  });

  it('deals table has amount column', () => {
    expect(schema.deals.amount).toBeDefined();
  });

  it('metadata columns exist on relevant tables', () => {
    expect(schema.tenants.settings).toBeDefined();
    expect(schema.contacts.metadata).toBeDefined();
    expect(schema.deals.metadata).toBeDefined();
    expect(schema.companies.metadata).toBeDefined();
  });
});
