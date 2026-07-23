/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';

// ── Helper: create a mock request function ──────────────
function createMockRequest(returnValue: unknown = {}) {
  return vi.fn().mockResolvedValue(returnValue);
}

// ── ContactsResource ─────────────────────────────────────
describe('ContactsResource', () => {
  it('list calls GET /contacts with params', async () => {
    const { ContactsResource } = await import('@/lib/sdk/resources/contacts');
    const req = createMockRequest({ data: [], total: 0, page: 1, limit: 10, hasMore: false });
    const resource = new ContactsResource(req);
    const result = await resource.list({ page: 2, limit: 20 });
    expect(req).toHaveBeenCalledWith('GET', '/contacts', undefined, { page: '2', limit: '20' });
    expect(result.data).toEqual([]);
  });

  it('list with no options sends empty params', async () => {
    const { ContactsResource } = await import('@/lib/sdk/resources/contacts');
    const req = createMockRequest({ data: [], total: 0, page: 1, limit: 10, hasMore: false });
    const resource = new ContactsResource(req);
    await resource.list();
    expect(req).toHaveBeenCalledWith('GET', '/contacts', undefined, {});
  });

  it('list with sort and order', async () => {
    const { ContactsResource } = await import('@/lib/sdk/resources/contacts');
    const req = createMockRequest({ data: [], total: 0, page: 1, limit: 10, hasMore: false });
    const resource = new ContactsResource(req);
    await resource.list({ sort: 'createdAt', order: 'desc' });
    expect(req).toHaveBeenCalledWith('GET', '/contacts', undefined, { sort: 'createdAt', order: 'desc' });
  });

  it('list with filters serializes to JSON', async () => {
    const { ContactsResource } = await import('@/lib/sdk/resources/contacts');
    const req = createMockRequest({ data: [], total: 0, page: 1, limit: 10, hasMore: false });
    const resource = new ContactsResource(req);
    await resource.list({ filters: { status: 'active' } });
    expect(req).toHaveBeenCalledWith('GET', '/contacts', undefined, { filters: '{"status":"active"}' });
  });

  it('list with search', async () => {
    const { ContactsResource } = await import('@/lib/sdk/resources/contacts');
    const req = createMockRequest({ data: [], total: 0, page: 1, limit: 10, hasMore: false });
    const resource = new ContactsResource(req);
    await resource.list({ search: 'john' });
    expect(req).toHaveBeenCalledWith('GET', '/contacts', undefined, { search: 'john' });
  });

  it('get calls GET /contacts/:id', async () => {
    const { ContactsResource } = await import('@/lib/sdk/resources/contacts');
    const req = createMockRequest({ id: 'c1', firstName: 'John' });
    const resource = new ContactsResource(req);
    const result = await resource.get('c1');
    expect(req).toHaveBeenCalledWith('GET', '/contacts/c1');
    expect(result.id).toBe('c1');
  });

  it('create calls POST /contacts with data', async () => {
    const { ContactsResource } = await import('@/lib/sdk/resources/contacts');
    const req = createMockRequest({ id: 'c2', firstName: 'Jane' });
    const resource = new ContactsResource(req);
    const result = await resource.create({ firstName: 'Jane' } as any);
    expect(req).toHaveBeenCalledWith('POST', '/contacts', { firstName: 'Jane' });
    expect(result.id).toBe('c2');
  });

  it('update calls PATCH /contacts/:id with data', async () => {
    const { ContactsResource } = await import('@/lib/sdk/resources/contacts');
    const req = createMockRequest({ id: 'c1', firstName: 'Updated' });
    const resource = new ContactsResource(req);
    const result = await resource.update('c1', { firstName: 'Updated' } as any);
    expect(req).toHaveBeenCalledWith('PATCH', '/contacts/c1', { firstName: 'Updated' });
    expect(result.firstName).toBe('Updated');
  });

  it('delete calls DELETE /contacts/:id', async () => {
    const { ContactsResource } = await import('@/lib/sdk/resources/contacts');
    const req = createMockRequest(undefined);
    const resource = new ContactsResource(req);
    await resource.delete('c1');
    expect(req).toHaveBeenCalledWith('DELETE', '/contacts/c1');
  });

  it('bulkUpdate calls PATCH /contacts/bulk with ids and data', async () => {
    const { ContactsResource } = await import('@/lib/sdk/resources/contacts');
    const req = createMockRequest({ updated: 3 });
    const resource = new ContactsResource(req);
    const result = await resource.bulkUpdate(['c1', 'c2', 'c3'], { firstName: 'Bulk' } as any);
    expect(req).toHaveBeenCalledWith('PATCH', '/contacts/bulk', { ids: ['c1', 'c2', 'c3'], firstName: 'Bulk' });
    expect(result.updated).toBe(3);
  });

  it('search calls GET /contacts with search param', async () => {
    const { ContactsResource } = await import('@/lib/sdk/resources/contacts');
    const req = createMockRequest({ data: [], total: 0, page: 1, limit: 10, hasMore: false });
    const resource = new ContactsResource(req);
    await resource.search('jane', { page: 1, limit: 5 });
    expect(req).toHaveBeenCalledWith('GET', '/contacts', undefined, { page: '1', limit: '5', search: 'jane' });
  });

  it('search without options', async () => {
    const { ContactsResource } = await import('@/lib/sdk/resources/contacts');
    const req = createMockRequest({ data: [], total: 0, page: 1, limit: 10, hasMore: false });
    const resource = new ContactsResource(req);
    await resource.search('test');
    expect(req).toHaveBeenCalledWith('GET', '/contacts', undefined, { search: 'test' });
  });
});

// ── DealsResource ────────────────────────────────────────
describe('DealsResource', () => {
  it('CRUD methods delegate to correct HTTP verbs', async () => {
    const { DealsResource } = await import('@/lib/sdk/resources/deals');
    const req = createMockRequest({ id: 'd1' });
    const resource = new DealsResource(req);

    await resource.list({ page: 1 });
    expect(req).toHaveBeenCalledWith('GET', '/deals', undefined, { page: '1' });

    await resource.get('d1');
    expect(req).toHaveBeenCalledWith('GET', '/deals/d1');

    await resource.create({ title: 'Deal' } as any);
    expect(req).toHaveBeenCalledWith('POST', '/deals', { title: 'Deal' });

    await resource.update('d1', { title: 'Updated' } as any);
    expect(req).toHaveBeenCalledWith('PATCH', '/deals/d1', { title: 'Updated' });

    await resource.delete('d1');
    expect(req).toHaveBeenCalledWith('DELETE', '/deals/d1');

    await resource.moveStage('d1', 'stage2');
    expect(req).toHaveBeenCalledWith('PATCH', '/deals/d1/stage', { stageId: 'stage2' });
  });
});

// ── LeadsResource ────────────────────────────────────────
describe('LeadsResource', () => {
  it('CRUD methods delegate to correct HTTP verbs', async () => {
    const { LeadsResource } = await import('@/lib/sdk/resources/leads');
    const req = createMockRequest({ id: 'l1' });
    const resource = new LeadsResource(req);

    await resource.list();
    expect(req).toHaveBeenCalledWith('GET', '/leads', undefined, {});

    await resource.get('l1');
    expect(req).toHaveBeenCalledWith('GET', '/leads/l1');

    await resource.create({ firstName: 'Lead' } as any);
    expect(req).toHaveBeenCalledWith('POST', '/leads', { firstName: 'Lead' });

    await resource.update('l1', { firstName: 'Updated' } as any);
    expect(req).toHaveBeenCalledWith('PATCH', '/leads/l1', { firstName: 'Updated' });

    await resource.delete('l1');
    expect(req).toHaveBeenCalledWith('DELETE', '/leads/l1');

    await resource.convert('l1');
    expect(req).toHaveBeenCalledWith('POST', '/leads/l1/convert');
  });
});

// ── CompaniesResource ────────────────────────────────────
describe('CompaniesResource', () => {
  it('CRUD methods delegate to correct HTTP verbs', async () => {
    const { CompaniesResource } = await import('@/lib/sdk/resources/companies');
    const req = createMockRequest({ id: 'co1' });
    const resource = new CompaniesResource(req);

    await resource.list();
    expect(req).toHaveBeenCalledWith('GET', '/companies', undefined, {});
    await resource.get('co1');
    expect(req).toHaveBeenCalledWith('GET', '/companies/co1');
    await resource.create({ name: 'Acme' } as any);
    expect(req).toHaveBeenCalledWith('POST', '/companies', { name: 'Acme' });
    await resource.update('co1', { name: 'Updated' } as any);
    expect(req).toHaveBeenCalledWith('PATCH', '/companies/co1', { name: 'Updated' });
    await resource.delete('co1');
    expect(req).toHaveBeenCalledWith('DELETE', '/companies/co1');
  });
});

// ── TasksResource ────────────────────────────────────────
describe('TasksResource', () => {
  it('CRUD methods delegate to correct HTTP verbs', async () => {
    const { TasksResource } = await import('@/lib/sdk/resources/tasks');
    const req = createMockRequest({ id: 't1' });
    const resource = new TasksResource(req);

    await resource.list();
    expect(req).toHaveBeenCalledWith('GET', '/tasks', undefined, {});
    await resource.get('t1');
    expect(req).toHaveBeenCalledWith('GET', '/tasks/t1');
    await resource.create({ title: 'Task' } as any);
    expect(req).toHaveBeenCalledWith('POST', '/tasks', { title: 'Task' });
    await resource.update('t1', { title: 'Done' } as any);
    expect(req).toHaveBeenCalledWith('PATCH', '/tasks/t1', { title: 'Done' });
    await resource.delete('t1');
    expect(req).toHaveBeenCalledWith('DELETE', '/tasks/t1');
  });
});

// ── TicketsResource ──────────────────────────────────────
describe('TicketsResource', () => {
  it('CRUD methods delegate to correct HTTP verbs', async () => {
    const { TicketsResource } = await import('@/lib/sdk/resources/tickets');
    const req = createMockRequest({ id: 'tk1' });
    const resource = new TicketsResource(req);

    await resource.list();
    expect(req).toHaveBeenCalledWith('GET', '/tickets', undefined, {});
    await resource.get('tk1');
    expect(req).toHaveBeenCalledWith('GET', '/tickets/tk1');
    await resource.create({ subject: 'Help' } as any);
    expect(req).toHaveBeenCalledWith('POST', '/tickets', { subject: 'Help' });
    await resource.update('tk1', { status: 'closed' } as any);
    expect(req).toHaveBeenCalledWith('PATCH', '/tickets/tk1', { status: 'closed' });
    await resource.delete('tk1');
    expect(req).toHaveBeenCalledWith('DELETE', '/tickets/tk1');
  });
});

// ── InvoicesResource ─────────────────────────────────────
describe('InvoicesResource', () => {
  it('CRUD methods delegate to correct HTTP verbs', async () => {
    const { InvoicesResource } = await import('@/lib/sdk/resources/invoices');
    const req = createMockRequest({ id: 'inv1' });
    const resource = new InvoicesResource(req);

    await resource.list();
    expect(req).toHaveBeenCalledWith('GET', '/invoices', undefined, {});
    await resource.get('inv1');
    expect(req).toHaveBeenCalledWith('GET', '/invoices/inv1');
    await resource.create({ amount: 100 } as any);
    expect(req).toHaveBeenCalledWith('POST', '/invoices', { amount: 100 });
    await resource.update('inv1', { amount: 200 } as any);
    expect(req).toHaveBeenCalledWith('PATCH', '/invoices/inv1', { amount: 200 });
    await resource.delete('inv1');
    expect(req).toHaveBeenCalledWith('DELETE', '/invoices/inv1');
  });
});

// ── DocumentsResource ────────────────────────────────────
describe('DocumentsResource', () => {
  it('CRUD methods delegate to correct HTTP verbs', async () => {
    const { DocumentsResource } = await import('@/lib/sdk/resources/documents');
    const req = createMockRequest({ id: 'doc1' });
    const resource = new DocumentsResource(req);

    await resource.list();
    expect(req).toHaveBeenCalledWith('GET', '/documents', undefined, {});
    await resource.get('doc1');
    expect(req).toHaveBeenCalledWith('GET', '/documents/doc1');
    await resource.create({ title: 'Doc' } as any);
    expect(req).toHaveBeenCalledWith('POST', '/documents', { title: 'Doc' });
    await resource.update('doc1', { title: 'Updated' } as any);
    expect(req).toHaveBeenCalledWith('PATCH', '/documents/doc1', { title: 'Updated' });
    await resource.delete('doc1');
    expect(req).toHaveBeenCalledWith('DELETE', '/documents/doc1');
  });
});

// ── QuotesResource ───────────────────────────────────────
describe('QuotesResource', () => {
  it('CRUD methods delegate to correct HTTP verbs', async () => {
    const { QuotesResource } = await import('@/lib/sdk/resources/quotes');
    const req = createMockRequest({ id: 'q1' });
    const resource = new QuotesResource(req);

    await resource.list();
    expect(req).toHaveBeenCalledWith('GET', '/quotes', undefined, {});
    await resource.get('q1');
    expect(req).toHaveBeenCalledWith('GET', '/quotes/q1');
    await resource.create({ title: 'Quote' } as any);
    expect(req).toHaveBeenCalledWith('POST', '/quotes', { title: 'Quote' });
    await resource.update('q1', { title: 'Updated' } as any);
    expect(req).toHaveBeenCalledWith('PATCH', '/quotes/q1', { title: 'Updated' });
    await resource.delete('q1');
    expect(req).toHaveBeenCalledWith('DELETE', '/quotes/q1');
  });
});

// ── OrdersResource ───────────────────────────────────────
describe('OrdersResource', () => {
  it('CRUD methods delegate to correct HTTP verbs', async () => {
    const { OrdersResource } = await import('@/lib/sdk/resources/orders');
    const req = createMockRequest({ id: 'o1' });
    const resource = new OrdersResource(req);

    await resource.list();
    expect(req).toHaveBeenCalledWith('GET', '/orders', undefined, {});
    await resource.get('o1');
    expect(req).toHaveBeenCalledWith('GET', '/orders/o1');
    await resource.create({ title: 'Order' } as any);
    expect(req).toHaveBeenCalledWith('POST', '/orders', { title: 'Order' });
    await resource.update('o1', { title: 'Updated' } as any);
    expect(req).toHaveBeenCalledWith('PATCH', '/orders/o1', { title: 'Updated' });
    await resource.delete('o1');
    expect(req).toHaveBeenCalledWith('DELETE', '/orders/o1');
  });
});

// ── ContractsResource ────────────────────────────────────
describe('ContractsResource', () => {
  it('CRUD methods delegate to correct HTTP verbs', async () => {
    const { ContractsResource } = await import('@/lib/sdk/resources/contracts');
    const req = createMockRequest({ id: 'ct1' });
    const resource = new ContractsResource(req);

    await resource.list();
    expect(req).toHaveBeenCalledWith('GET', '/contracts', undefined, {});
    await resource.get('ct1');
    expect(req).toHaveBeenCalledWith('GET', '/contracts/ct1');
    await resource.create({ title: 'Contract' } as any);
    expect(req).toHaveBeenCalledWith('POST', '/contracts', { title: 'Contract' });
    await resource.update('ct1', { title: 'Updated' } as any);
    expect(req).toHaveBeenCalledWith('PATCH', '/contracts/ct1', { title: 'Updated' });
    await resource.delete('ct1');
    expect(req).toHaveBeenCalledWith('DELETE', '/contracts/ct1');
  });
});

// ── SubscriptionsResource ────────────────────────────────
describe('SubscriptionsResource', () => {
  it('CRUD + lifecycle methods delegate to correct HTTP verbs', async () => {
    const { SubscriptionsResource } = await import('@/lib/sdk/resources/subscriptions');
    const req = createMockRequest({ id: 'sub1' });
    const resource = new SubscriptionsResource(req);

    await resource.list();
    expect(req).toHaveBeenCalledWith('GET', '/subscriptions', undefined, {});
    await resource.get('sub1');
    expect(req).toHaveBeenCalledWith('GET', '/subscriptions/sub1');
    await resource.create({ plan: 'pro' } as any);
    expect(req).toHaveBeenCalledWith('POST', '/subscriptions', { plan: 'pro' });
    await resource.update('sub1', { plan: 'enterprise' } as any);
    expect(req).toHaveBeenCalledWith('PATCH', '/subscriptions/sub1', { plan: 'enterprise' });
    await resource.cancel('sub1');
    expect(req).toHaveBeenCalledWith('POST', '/subscriptions/sub1/cancel');
    await resource.pause('sub1');
    expect(req).toHaveBeenCalledWith('POST', '/subscriptions/sub1/pause');
    await resource.resume('sub1');
    expect(req).toHaveBeenCalledWith('POST', '/subscriptions/sub1/resume');
  });
});

// ── ServicesResource ─────────────────────────────────────
describe('ServicesResource', () => {
  it('CRUD methods delegate to correct HTTP verbs', async () => {
    const { ServicesResource } = await import('@/lib/sdk/resources/services');
    const req = createMockRequest({ id: 'svc1' });
    const resource = new ServicesResource(req);

    await resource.list();
    expect(req).toHaveBeenCalledWith('GET', '/services', undefined, {});
    await resource.get('svc1');
    expect(req).toHaveBeenCalledWith('GET', '/services/svc1');
    await resource.create({ name: 'Service' } as any);
    expect(req).toHaveBeenCalledWith('POST', '/services', { name: 'Service' });
    await resource.update('svc1', { name: 'Updated' } as any);
    expect(req).toHaveBeenCalledWith('PATCH', '/services/svc1', { name: 'Updated' });
    await resource.delete('svc1');
    expect(req).toHaveBeenCalledWith('DELETE', '/services/svc1');
  });
});

// ── MeetingsResource ─────────────────────────────────────
describe('MeetingsResource', () => {
  it('CRUD methods delegate to correct HTTP verbs', async () => {
    const { MeetingsResource } = await import('@/lib/sdk/resources/meetings');
    const req = createMockRequest({ id: 'm1' });
    const resource = new MeetingsResource(req);

    await resource.list();
    expect(req).toHaveBeenCalledWith('GET', '/meetings', undefined, {});
    await resource.get('m1');
    expect(req).toHaveBeenCalledWith('GET', '/meetings/m1');
    await resource.create({ title: 'Meeting' } as any);
    expect(req).toHaveBeenCalledWith('POST', '/meetings', { title: 'Meeting' });
    await resource.update('m1', { title: 'Updated' } as any);
    expect(req).toHaveBeenCalledWith('PATCH', '/meetings/m1', { title: 'Updated' });
    await resource.delete('m1');
    expect(req).toHaveBeenCalledWith('DELETE', '/meetings/m1');
  });
});

// ── ActivitiesResource ───────────────────────────────────
describe('ActivitiesResource', () => {
  it('CRUD methods delegate to correct HTTP verbs', async () => {
    const { ActivitiesResource } = await import('@/lib/sdk/resources/activities');
    const req = createMockRequest({ id: 'a1' });
    const resource = new ActivitiesResource(req);

    await resource.list();
    expect(req).toHaveBeenCalledWith('GET', '/activities', undefined, {});
    await resource.get('a1');
    expect(req).toHaveBeenCalledWith('GET', '/activities/a1');
    await resource.create({ type: 'note' } as any);
    expect(req).toHaveBeenCalledWith('POST', '/activities', { type: 'note' });
  });
});

// ── FormsResource ────────────────────────────────────────
describe('FormsResource', () => {
  it('CRUD methods delegate to correct HTTP verbs', async () => {
    const { FormsResource } = await import('@/lib/sdk/resources/forms');
    const req = createMockRequest({ id: 'f1' });
    const resource = new FormsResource(req);

    await resource.list();
    expect(req).toHaveBeenCalledWith('GET', '/forms', undefined, {});
    await resource.get('f1');
    expect(req).toHaveBeenCalledWith('GET', '/forms/f1');
    await resource.create({ title: 'Form' } as any);
    expect(req).toHaveBeenCalledWith('POST', '/forms', { title: 'Form' });
    await resource.update('f1', { title: 'Updated' } as any);
    expect(req).toHaveBeenCalledWith('PATCH', '/forms/f1', { title: 'Updated' });
    await resource.delete('f1');
    expect(req).toHaveBeenCalledWith('DELETE', '/forms/f1');
  });
});

// ── SequencesResource ────────────────────────────────────
describe('SequencesResource', () => {
  it('CRUD methods delegate to correct HTTP verbs', async () => {
    const { SequencesResource } = await import('@/lib/sdk/resources/sequences');
    const req = createMockRequest({ id: 'seq1' });
    const resource = new SequencesResource(req);

    await resource.list();
    expect(req).toHaveBeenCalledWith('GET', '/sequences', undefined, {});
    await resource.get('seq1');
    expect(req).toHaveBeenCalledWith('GET', '/sequences/seq1');
    await resource.create({ name: 'Sequence' } as any);
    expect(req).toHaveBeenCalledWith('POST', '/sequences', { name: 'Sequence' });
    await resource.update('seq1', { name: 'Updated' } as any);
    expect(req).toHaveBeenCalledWith('PATCH', '/sequences/seq1', { name: 'Updated' });
    await resource.delete('seq1');
    expect(req).toHaveBeenCalledWith('DELETE', '/sequences/seq1');
  });
});

// ── AutomationsResource ──────────────────────────────────
describe('AutomationsResource', () => {
  it('CRUD methods delegate to correct HTTP verbs', async () => {
    const { AutomationsResource } = await import('@/lib/sdk/resources/automations');
    const req = createMockRequest({ id: 'auto1' });
    const resource = new AutomationsResource(req);

    await resource.list();
    expect(req).toHaveBeenCalledWith('GET', '/automations', undefined, {});
    await resource.get('auto1');
    expect(req).toHaveBeenCalledWith('GET', '/automations/auto1');
    await resource.create({ name: 'Automation' } as any);
    expect(req).toHaveBeenCalledWith('POST', '/automations', { name: 'Automation' });
    await resource.update('auto1', { name: 'Updated' } as any);
    expect(req).toHaveBeenCalledWith('PATCH', '/automations/auto1', { name: 'Updated' });
    await resource.delete('auto1');
    expect(req).toHaveBeenCalledWith('DELETE', '/automations/auto1');
  });
});

// ── ReportsResource ──────────────────────────────────────
describe('ReportsResource', () => {
  it('CRUD methods delegate to correct HTTP verbs', async () => {
    const { ReportsResource } = await import('@/lib/sdk/resources/reports');
    const req = createMockRequest({ id: 'r1' });
    const resource = new ReportsResource(req);

    await resource.list();
    expect(req).toHaveBeenCalledWith('GET', '/reports', undefined, {});
    await resource.get('r1');
    expect(req).toHaveBeenCalledWith('GET', '/reports/r1');
    await resource.create({ title: 'Report' } as any);
    expect(req).toHaveBeenCalledWith('POST', '/reports', { title: 'Report' });
    await resource.delete('r1');
    expect(req).toHaveBeenCalledWith('DELETE', '/reports/r1');
    await resource.run('r1');
    expect(req).toHaveBeenCalledWith('POST', '/reports/r1/run');
  });
});
