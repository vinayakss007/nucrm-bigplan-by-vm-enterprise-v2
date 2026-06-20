import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbSelectResolve = vi.fn();

const mockFrom = vi.fn(() => ({
  where: vi.fn(() => ({
    limit: vi.fn(() => mockDbSelectResolve()),
  })),
}));

vi.mock('@/drizzle/db', () => ({
  db: { select: vi.fn(() => ({ from: mockFrom })) },
}));

vi.mock('@/drizzle/schema/crm', () => ({
  contacts: { id: 'id', tenantId: 'tenant_id', firstName: 'first_name', lastName: 'last_name', email: 'email', leadStatus: 'lead_status', lifecycleStage: 'lifecycle_stage', notes: 'notes', companyId: 'company_id', jobTitle: 'job_title', phone: 'phone', leadSource: 'lead_source' },
  companies: { id: 'id', tenantId: 'tenant_id', name: 'name', industry: 'industry', website: 'website' },
  deals: { id: 'id', tenantId: 'tenant_id', title: 'title', amount: 'amount', stageId: 'stage_id', contactId: 'contact_id', companyId: 'company_id', closeDate: 'close_date', updatedAt: 'updated_at' },
}));

vi.mock('@/drizzle/schema/core', () => ({
  tenants: { id: 'id', name: 'name', primaryColor: 'primary_color' },
  users: { id: 'id', fullName: 'full_name', email: 'email' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...a: unknown[]) => ({ type: 'eq', args: a })),
  and: vi.fn((...a: unknown[]) => ({ type: 'and', args: a })),
  isNull: vi.fn((...a: unknown[]) => ({ type: 'isNull', args: a })),
  sql: Object.assign(vi.fn(() => ({ type: 'sql' })), { raw: vi.fn() }),
}));

describe('AI Draft', () => {
  let mod: typeof import('@/lib/ai/draft');

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbSelectResolve.mockReset();
    mod = await import('@/lib/ai/draft');
  });

  describe('hydrateDraftContext', () => {
    it('returns tenant and user context for contact entity', async () => {
      mockDbSelectResolve
        .mockResolvedValueOnce([{ id: 'tenant-1', name: 'Test Corp', primary_color: '#000' }])
        .mockResolvedValueOnce([{ id: 'user-1', name: 'John Doe', email: 'john@test.com' }])
        .mockResolvedValueOnce([{ id: 'contact-1', first_name: 'Jane', last_name: 'Smith', email: 'j@test.com', lead_status: 'new', lifecycle_stage: 'lead', notes: 'Interested', company_id: null }])
        .mockResolvedValueOnce([{ tenantId: 'tenant-1' }]);

      const result = await mod.hydrateDraftContext('tenant-1', 'user-1', { entityType: 'contact', entityId: 'contact-1' });

      expect(result.tenant?.name).toBe('Test Corp');
      expect(result.user?.name).toBe('John Doe');
      expect(result.contact?.first_name).toBe('Jane');
    });

    it('handles deal entity with nested contact and company', async () => {
      mockDbSelectResolve
        .mockResolvedValueOnce([{ id: 'tenant-1', name: 'T', primary_color: '#000' }])
        .mockResolvedValueOnce([{ id: 'user-1', name: 'U', email: 'u@t.com' }])
        .mockResolvedValueOnce([{ id: 'deal-1', title: 'Big Deal', amount: '50000', stage_id: 'stage-1', contact_id: 'contact-1', company_id: 'company-1', close_date: null }])
        .mockResolvedValueOnce([{ tenantId: 'tenant-1' }])
        .mockResolvedValueOnce([{ id: 'contact-1', first_name: 'Alice', last_name: 'W', email: 'a@t.com' }])
        .mockResolvedValueOnce([{ id: 'company-1', name: 'Acme', industry: 'Tech', website: 'acme.com' }])
        .mockResolvedValueOnce([{ tenantId: 'tenant-1' }]);

      const result = await mod.hydrateDraftContext('tenant-1', 'user-1', { entityType: 'deal', entityId: 'deal-1' });

      expect(result.deal?.title).toBe('Big Deal');
      expect(result.contact?.first_name).toBe('Alice');
      expect(result.company?.name).toBe('Acme');
    });

    it('handles company entity type', async () => {
      mockDbSelectResolve
        .mockResolvedValueOnce([{ id: 'tenant-1', name: 'T', primary_color: '#000' }])
        .mockResolvedValueOnce([{ id: 'user-1', name: 'U', email: 'u@t.com' }])
        .mockResolvedValueOnce([{ id: 'company-1', name: 'Big Co', industry: 'Finance', website: 'bigco.com' }])
        .mockResolvedValueOnce([{ tenantId: 'tenant-1' }]);

      const result = await mod.hydrateDraftContext('tenant-1', 'user-1', { entityType: 'company', entityId: 'company-1' });

      expect(result.company?.name).toBe('Big Co');
    });

    it('rejects entity from a different tenant', async () => {
      mockDbSelectResolve
        .mockResolvedValueOnce([{ id: 'tenant-1', name: 'T', primary_color: '#000' }])
        .mockResolvedValueOnce([{ id: 'user-1', name: 'U', email: 'u@t.com' }])
        .mockResolvedValueOnce([{ id: 'contact-1', first_name: 'Jane', last_name: 'S', email: 'j@o.com', lead_status: 'new', lifecycle_stage: 'lead', notes: '', company_id: null }])
        .mockResolvedValueOnce([{ tenantId: 'other-tenant' }]);

      const result = await mod.hydrateDraftContext('tenant-1', 'user-1', { entityType: 'contact', entityId: 'contact-1' });

      expect(result.contact).toBeUndefined();
    });

    it('returns minimal context for unsupported entity types', async () => {
      mockDbSelectResolve
        .mockResolvedValueOnce([{ id: 'tenant-1', name: 'T', primary_color: '#000' }])
        .mockResolvedValueOnce([{ id: 'user-1', name: 'U', email: 'u@t.com' }]);

      const result = await mod.hydrateDraftContext('tenant-1', 'user-1', { entityType: 'ticket', entityId: 'ticket-1' });

      expect(result.tenant).toBeDefined();
      expect(result.user).toBeDefined();
      expect(result.contact).toBeUndefined();
    });
  });

  describe('interpolate', () => {
    it('replaces tokens from context', () => {
      const ctx = { contact: { first_name: 'Jane', last_name: 'Doe' }, company: { name: 'Acme' } };
      expect(mod.interpolate('Hi {{contact.first_name}} from {{company.name}}', ctx)).toBe('Hi Jane from Acme');
    });

    it('returns empty for unknown keys', () => {
      expect(mod.interpolate('{{contact.unknown}}', { contact: { first_name: 'J' } })).toBe('');
    });

    it('returns empty for missing scope', () => {
      expect(mod.interpolate('{{deal.title}}', {})).toBe('');
    });

    it('handles null and undefined values', () => {
      const ctx = { contact: { first_name: 'Jane', notes: null }, deal: { amount: undefined } };
      expect(mod.interpolate('{{contact.first_name}} {{contact.notes}} {{deal.amount}}', ctx)).toBe('Jane  ');
    });

    it('handles multiple tokens', () => {
      const ctx = {
        contact: { first_name: 'Jane', last_name: 'Doe' },
        company: { name: 'Acme' },
        deal: { title: 'Big', amount: '50000' },
      };
      expect(mod.interpolate('{{contact.first_name}} at {{company.name}}, {{deal.title}} ${{deal.amount}}', ctx))
        .toBe('Jane at Acme, Big $50000');
    });
  });

  describe('SEED_DRAFT_TEMPLATES', () => {
    it('provides 5 seed templates', () => {
      expect(mod.SEED_DRAFT_TEMPLATES).toHaveLength(5);
    });

    it('each template has required fields', () => {
      for (const t of mod.SEED_DRAFT_TEMPLATES) {
        expect(t.slug).toBeTruthy();
        expect(t.name).toBeTruthy();
        expect(t.kind).toMatch(/^(email|note|reply|call_prep)$/);
      }
    });

    it('follow-up template references contact and deal tokens', () => {
      const t = mod.SEED_DRAFT_TEMPLATES.find(x => x.slug === 'follow-up-after-meeting');
      expect(t?.userPrompt).toContain('{{contact.first_name}}');
      expect(t?.userPrompt).toContain('{{deal.title}}');
    });

    it('cold outbound template uses company in subject', () => {
      const t = mod.SEED_DRAFT_TEMPLATES.find(x => x.slug === 'cold-outbound-personalised');
      expect(t?.defaultSubject).toContain('{{company.name}}');
    });
  });
});
