import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock drizzle DB
vi.mock('@/drizzle/db', () => ({
  db: {
    execute: vi.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => []),
          })),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [{ id: 'req-1', tenantId: 'tenant-1', type: 'gdpr_export', status: 'pending' }]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => []),
        })),
      })),
    })),
  },
}));

vi.mock('@/drizzle/schema/compliance', () => ({
  complianceRequests: {
    id: 'id',
    tenantId: 'tenant_id',
    type: 'type',
    status: 'status',
    requestedBy: 'requested_by',
    completedAt: 'completed_at',
    metadata: 'metadata',
    result: 'result',
    errorMessage: 'error_message',
    createdAt: 'created_at',
  },
  dataRetentionPolicies: {
    id: 'id',
    tenantId: 'tenant_id',
    entityType: 'entity_type',
    retentionDays: 'retention_days',
    action: 'action',
    isActive: 'is_active',
    lastExecutedAt: 'last_executed_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((col: unknown) => col),
  sql: Object.assign(vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })), {
    identifier: vi.fn((name: string) => name),
  }),
}));

describe('Compliance - GDPR Export', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('exports tenant data with all required categories', async () => {
    const { db } = await import('@/drizzle/db');
    
    // Mock contacts
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [
        { id: 'c1', first_name: 'John', last_name: 'Doe', email: 'john@test.com', phone: '555-1234', company_id: null, metadata: {}, created_at: '2024-01-01' },
      ],
      rowCount: 1,
    });
    // Mock companies
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ id: 'co1', name: 'Acme', domain: 'acme.com', industry: 'Tech', size: '50', metadata: {}, created_at: '2024-01-01' }],
      rowCount: 1,
    });
    // Mock deals
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ id: 'd1', title: 'Deal 1', value: 1000, currency: 'USD' }],
      rowCount: 1,
    });
    // Mock tasks
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // Mock activities
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // Mock emails
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // Mock notes
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // Mock files
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const { exportTenantData } = await import('@/lib/compliance/gdpr');
    const result = await exportTenantData('tenant-1');

    expect(result.tenantId).toBe('tenant-1');
    expect(result.exportedAt).toBeDefined();
    expect(result.categories).toHaveProperty('contacts');
    expect(result.categories).toHaveProperty('companies');
    expect(result.categories).toHaveProperty('deals');
    expect(result.categories).toHaveProperty('tasks');
    expect(result.categories).toHaveProperty('activities');
    expect(result.categories).toHaveProperty('emails');
    expect(result.categories).toHaveProperty('notes');
    expect(result.categories).toHaveProperty('files');
    expect(result.categories.contacts).toHaveLength(1);
    expect(result.categories.companies).toHaveLength(1);
    expect(result.metadata.totalRecords).toBe(3);
    expect(result.metadata.dataCategories).toContain('contacts');
    expect(result.metadata.dataCategories).toContain('companies');
    expect(result.metadata.dataCategories).toContain('deals');
  });

  it('handles empty tenant data gracefully', async () => {
    const { db } = await import('@/drizzle/db');
    
    // All queries return empty
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [], rowCount: 0 });

    const { exportTenantData } = await import('@/lib/compliance/gdpr');
    const result = await exportTenantData('tenant-empty');

    expect(result.tenantId).toBe('tenant-empty');
    expect(result.categories.contacts).toHaveLength(0);
    expect(result.metadata.totalRecords).toBe(0);
    expect(result.metadata.dataCategories).toHaveLength(0);
  });

  it('handles database errors gracefully for individual tables', async () => {
    const { db } = await import('@/drizzle/db');

    // Simulate table not existing
    (db.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('relation "contacts" does not exist'));

    const { exportTenantData } = await import('@/lib/compliance/gdpr');
    const result = await exportTenantData('tenant-1');

    // Should not throw, just return empty arrays
    expect(result.tenantId).toBe('tenant-1');
    expect(result.categories.contacts).toHaveLength(0);
  });
});

describe('Compliance - GDPR Anonymization', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('anonymizes tenant data and returns counts', async () => {
    const { db } = await import('@/drizzle/db');
    
    (db.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [], rowCount: 5 })  // contacts
      .mockResolvedValueOnce({ rows: [], rowCount: 3 })  // companies
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })  // notes
      .mockResolvedValueOnce({ rows: [], rowCount: 4 })  // activities
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // emails

    const { anonymizeTenantData } = await import('@/lib/compliance/gdpr');
    const result = await anonymizeTenantData('tenant-1');

    expect(result.tenantId).toBe('tenant-1');
    expect(result.processedAt).toBeDefined();
    expect(result.anonymizedRecords).toBe(15);
    expect(result.categories['contacts']).toBe(5);
    expect(result.categories['companies']).toBe(3);
    expect(result.categories['notes']).toBe(2);
    expect(result.categories['activities']).toBe(4);
    expect(result.categories['emails']).toBe(1);
  });

  it('handles zero records gracefully', async () => {
    const { db } = await import('@/drizzle/db');
    
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [], rowCount: 0 });

    const { anonymizeTenantData } = await import('@/lib/compliance/gdpr');
    const result = await anonymizeTenantData('tenant-no-data');

    expect(result.anonymizedRecords).toBe(0);
  });
});

describe('Compliance - SOC 2 Report Generation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('generates a report with all five trust service categories', async () => {
    const { db } = await import('@/drizzle/db');
    
    // Mock all DB queries used in SOC 2 report generation
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [{ count: 0 }], rowCount: 1 });

    const { generateSOC2Report } = await import('@/lib/compliance/soc2');
    const report = await generateSOC2Report('tenant-1', 90);

    expect(report.tenantId).toBe('tenant-1');
    expect(report.generatedAt).toBeDefined();
    expect(report.reportPeriod.start).toBeDefined();
    expect(report.reportPeriod.end).toBeDefined();
    expect(report.sections).toHaveLength(5);

    const categoryNames = report.sections.map(s => s.category);
    expect(categoryNames).toContain('Security');
    expect(categoryNames).toContain('Availability');
    expect(categoryNames).toContain('Processing Integrity');
    expect(categoryNames).toContain('Confidentiality');
    expect(categoryNames).toContain('Privacy');
  });

  it('reports compliant status when all controls pass', async () => {
    const { db } = await import('@/drizzle/db');
    
    // Return data that satisfies all controls
    (db.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ count: 3 }], rowCount: 1 }) // roles configured
      .mockResolvedValueOnce({ rows: [{ count: 1 }], rowCount: 1 }) // SSO configured
      .mockResolvedValueOnce({ rows: [{ count: 100 }], rowCount: 1 }) // audit logs
      .mockResolvedValueOnce({ rows: [{ count: 50 }], rowCount: 1 }) // changes tracked
      .mockResolvedValueOnce({ rows: [{ count: 1 }], rowCount: 1 }); // retention policies

    const { generateSOC2Report } = await import('@/lib/compliance/soc2');
    const report = await generateSOC2Report('tenant-1', 90);

    expect(report.overallStatus).toBe('compliant');
    expect(report.summary.failures).toBe(0);
    expect(report.summary.passing).toBeGreaterThan(0);
  });

  it('reports partial status when some controls have warnings', async () => {
    const { db } = await import('@/drizzle/db');
    
    // No roles, no SSO, no audit logs, no retention - triggers warnings
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [{ count: 0 }], rowCount: 1 });

    const { generateSOC2Report } = await import('@/lib/compliance/soc2');
    const report = await generateSOC2Report('tenant-1', 30);

    expect(report.overallStatus).toBe('partial');
    expect(report.summary.warnings).toBeGreaterThan(0);
  });

  it('calculates correct summary totals', async () => {
    const { db } = await import('@/drizzle/db');
    
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [{ count: 5 }], rowCount: 1 });

    const { generateSOC2Report } = await import('@/lib/compliance/soc2');
    const report = await generateSOC2Report('tenant-1');

    const totalFromSections = report.sections.reduce((sum, s) => sum + s.controls.length, 0);
    expect(report.summary.totalControls).toBe(totalFromSections);
    expect(report.summary.passing + report.summary.warnings + report.summary.failures).toBe(report.summary.totalControls);
  });
});
