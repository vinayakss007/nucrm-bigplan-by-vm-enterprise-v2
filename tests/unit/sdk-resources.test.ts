/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ActivitiesResource } from '@/lib/sdk/resources/activities';
import { AutomationsResource } from '@/lib/sdk/resources/automations';
import { CompaniesResource } from '@/lib/sdk/resources/companies';
import { ContactsResource } from '@/lib/sdk/resources/contacts';
import { ContractsResource } from '@/lib/sdk/resources/contracts';
import { DealsResource } from '@/lib/sdk/resources/deals';
import { DocumentsResource } from '@/lib/sdk/resources/documents';
import { FormsResource } from '@/lib/sdk/resources/forms';
import { InvoicesResource } from '@/lib/sdk/resources/invoices';
import { LeadsResource } from '@/lib/sdk/resources/leads';
import { MeetingsResource } from '@/lib/sdk/resources/meetings';
import { OrdersResource } from '@/lib/sdk/resources/orders';
import { QuotesResource } from '@/lib/sdk/resources/quotes';
import { ReportsResource } from '@/lib/sdk/resources/reports';
import { SequencesResource } from '@/lib/sdk/resources/sequences';
import { ServicesResource } from '@/lib/sdk/resources/services';
import { SubscriptionsResource } from '@/lib/sdk/resources/subscriptions';
import { TasksResource } from '@/lib/sdk/resources/tasks';

// ---------------------------------------------------------------------------
// Shared test factory for SDK resource classes
// ---------------------------------------------------------------------------

interface ResourceSpec {
  name: string;
  ResourceClass: new (request: any) => any;
  basePath: string;
  /** Whether this resource exposes an update method */
  hasUpdate: boolean;
  /** Whether this resource exposes a delete method */
  hasDelete: boolean;
  /** Whether this resource exposes a search method (like contacts) */
  hasSearch: boolean;
  /** Whether this resource exposes a bulkUpdate method (like contacts) */
  hasBulkUpdate: boolean;
}

const resourceSpecs: ResourceSpec[] = [
  { name: 'Activities', ResourceClass: ActivitiesResource, basePath: '/activities', hasUpdate: false, hasDelete: false, hasSearch: false, hasBulkUpdate: false },
  { name: 'Automations', ResourceClass: AutomationsResource, basePath: '/automations', hasUpdate: true, hasDelete: true, hasSearch: false, hasBulkUpdate: false },
  { name: 'Companies', ResourceClass: CompaniesResource, basePath: '/companies', hasUpdate: true, hasDelete: true, hasSearch: false, hasBulkUpdate: false },
  { name: 'Contacts', ResourceClass: ContactsResource, basePath: '/contacts', hasUpdate: true, hasDelete: true, hasSearch: true, hasBulkUpdate: true },
  { name: 'Contracts', ResourceClass: ContractsResource, basePath: '/contracts', hasUpdate: true, hasDelete: true, hasSearch: false, hasBulkUpdate: false },
  { name: 'Deals', ResourceClass: DealsResource, basePath: '/deals', hasUpdate: true, hasDelete: true, hasSearch: false, hasBulkUpdate: false },
  { name: 'Documents', ResourceClass: DocumentsResource, basePath: '/documents', hasUpdate: true, hasDelete: true, hasSearch: false, hasBulkUpdate: false },
  { name: 'Forms', ResourceClass: FormsResource, basePath: '/forms', hasUpdate: true, hasDelete: true, hasSearch: false, hasBulkUpdate: false },
  { name: 'Invoices', ResourceClass: InvoicesResource, basePath: '/invoices', hasUpdate: true, hasDelete: true, hasSearch: false, hasBulkUpdate: false },
  { name: 'Leads', ResourceClass: LeadsResource, basePath: '/leads', hasUpdate: true, hasDelete: true, hasSearch: false, hasBulkUpdate: false },
  { name: 'Meetings', ResourceClass: MeetingsResource, basePath: '/meetings', hasUpdate: true, hasDelete: true, hasSearch: false, hasBulkUpdate: false },
  { name: 'Orders', ResourceClass: OrdersResource, basePath: '/orders', hasUpdate: true, hasDelete: true, hasSearch: false, hasBulkUpdate: false },
  { name: 'Quotes', ResourceClass: QuotesResource, basePath: '/quotes', hasUpdate: true, hasDelete: true, hasSearch: false, hasBulkUpdate: false },
  { name: 'Reports', ResourceClass: ReportsResource, basePath: '/reports', hasUpdate: false, hasDelete: true, hasSearch: false, hasBulkUpdate: false },
  { name: 'Sequences', ResourceClass: SequencesResource, basePath: '/sequences', hasUpdate: true, hasDelete: true, hasSearch: false, hasBulkUpdate: false },
  { name: 'Services', ResourceClass: ServicesResource, basePath: '/services', hasUpdate: true, hasDelete: true, hasSearch: false, hasBulkUpdate: false },
  { name: 'Subscriptions', ResourceClass: SubscriptionsResource, basePath: '/subscriptions', hasUpdate: true, hasDelete: false, hasSearch: false, hasBulkUpdate: false },
  { name: 'Tasks', ResourceClass: TasksResource, basePath: '/tasks', hasUpdate: true, hasDelete: true, hasSearch: false, hasBulkUpdate: false },
];

describe('SDK Resources - shared CRUD factory', () => {
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRequest = vi.fn().mockResolvedValue({ id: 'test-1' });
  });

  // -------------------------------------------------------------------------
  // Table-driven CRUD tests for all 18 resources
  // -------------------------------------------------------------------------
  describe.each(resourceSpecs)(
    '$name Resource',
    ({ ResourceClass, basePath, hasUpdate, hasDelete, hasSearch, hasBulkUpdate }) => {
      let resource: any;

      beforeEach(() => {
        mockRequest = vi.fn().mockResolvedValue({ id: 'test-1' });
        resource = new ResourceClass(mockRequest);
      });

      it('list() calls GET on the base path with no params when no options given', async () => {
        await resource.list();
        expect(mockRequest).toHaveBeenCalledWith('GET', basePath, undefined, {});
      });

      it('list() forwards pagination params correctly', async () => {
        mockRequest.mockResolvedValue({ data: [], total: 0, page: 2, limit: 25, hasMore: false });
        await resource.list({ page: 2, limit: 25 });
        expect(mockRequest).toHaveBeenCalledWith('GET', basePath, undefined, { page: '2', limit: '25' });
      });

      it('get() calls GET on basePath/:id', async () => {
        await resource.get('abc-123');
        expect(mockRequest).toHaveBeenCalledWith('GET', `${basePath}/abc-123`);
      });

      it('create() calls POST on the base path with body', async () => {
        const data = { name: 'test-item' };
        await resource.create(data);
        expect(mockRequest).toHaveBeenCalledWith('POST', basePath, data);
      });

      if (hasUpdate) {
        it('update() calls PATCH on basePath/:id with body', async () => {
          const data = { name: 'updated' };
          await resource.update('abc-123', data);
          expect(mockRequest).toHaveBeenCalledWith('PATCH', `${basePath}/abc-123`, data);
        });
      }

      if (hasDelete) {
        it('delete() calls DELETE on basePath/:id', async () => {
          mockRequest.mockResolvedValue(undefined);
          await resource.delete('abc-123');
          expect(mockRequest).toHaveBeenCalledWith('DELETE', `${basePath}/abc-123`);
        });
      }

      if (hasSearch) {
        it('search() calls GET on the base path with search param', async () => {
          mockRequest.mockResolvedValue({ data: [], total: 0, page: 1, limit: 10, hasMore: false });
          await resource.search('query-text');
          expect(mockRequest).toHaveBeenCalledWith('GET', basePath, undefined, { search: 'query-text' });
        });

        it('search() merges ListOptions with the query', async () => {
          mockRequest.mockResolvedValue({ data: [], total: 0, page: 1, limit: 5, hasMore: false });
          await resource.search('hello', { page: 1, limit: 5 });
          expect(mockRequest).toHaveBeenCalledWith('GET', basePath, undefined, {
            page: '1',
            limit: '5',
            search: 'hello',
          });
        });
      }

      if (hasBulkUpdate) {
        it('bulkUpdate() calls PATCH on basePath/bulk with ids and data', async () => {
          mockRequest.mockResolvedValue({ updated: 2 });
          const result = await resource.bulkUpdate(['id1', 'id2'], { status: 'active' });
          expect(mockRequest).toHaveBeenCalledWith('PATCH', `${basePath}/bulk`, {
            ids: ['id1', 'id2'],
            status: 'active',
          });
          expect(result.updated).toBe(2);
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // buildParams() serialization tests
  // -------------------------------------------------------------------------
  describe('buildParams() serializes ListOptions correctly', () => {
    it('serializes all option fields', async () => {
      const resource = new ContactsResource(mockRequest);
      mockRequest.mockResolvedValue({ data: [], total: 0, page: 3, limit: 50, hasMore: false });

      await resource.list({
        page: 3,
        limit: 50,
        sort: 'createdAt',
        order: 'desc',
        search: 'john',
        filters: { status: 'active', role: 'admin' },
      });

      expect(mockRequest).toHaveBeenCalledWith('GET', '/contacts', undefined, {
        page: '3',
        limit: '50',
        sort: 'createdAt',
        order: 'desc',
        search: 'john',
        filters: JSON.stringify({ status: 'active', role: 'admin' }),
      });
    });

    it('omits undefined fields from params', async () => {
      const resource = new DealsResource(mockRequest);
      mockRequest.mockResolvedValue({ data: [], total: 0, page: 1, limit: 10, hasMore: false });

      await resource.list({ page: 1 });
      expect(mockRequest).toHaveBeenCalledWith('GET', '/deals', undefined, { page: '1' });
    });

    it('returns empty object when options is undefined', async () => {
      const resource = new LeadsResource(mockRequest);
      mockRequest.mockResolvedValue({ data: [], total: 0, page: 1, limit: 10, hasMore: false });

      await resource.list();
      expect(mockRequest).toHaveBeenCalledWith('GET', '/leads', undefined, {});
    });

    it('serializes filters as JSON string', async () => {
      const resource = new CompaniesResource(mockRequest);
      mockRequest.mockResolvedValue({ data: [], total: 0, page: 1, limit: 10, hasMore: false });

      const filters = { industry: 'tech', size: 'large' };
      await resource.list({ filters });
      expect(mockRequest).toHaveBeenCalledWith('GET', '/companies', undefined, {
        filters: '{"industry":"tech","size":"large"}',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Error propagation tests
  // -------------------------------------------------------------------------
  describe('errors from request() propagate properly', () => {
    it('list() propagates request errors', async () => {
      mockRequest.mockRejectedValue(new Error('Network failure'));
      const resource = new ContactsResource(mockRequest);
      await expect(resource.list()).rejects.toThrow('Network failure');
    });

    it('get() propagates request errors', async () => {
      mockRequest.mockRejectedValue(new Error('Not found'));
      const resource = new DealsResource(mockRequest);
      await expect(resource.get('bad-id')).rejects.toThrow('Not found');
    });

    it('create() propagates request errors', async () => {
      mockRequest.mockRejectedValue(new Error('Validation failed'));
      const resource = new LeadsResource(mockRequest);
      await expect(resource.create({ firstName: 'X' } as any)).rejects.toThrow('Validation failed');
    });

    it('update() propagates request errors', async () => {
      mockRequest.mockRejectedValue(new Error('Forbidden'));
      const resource = new TasksResource(mockRequest);
      await expect(resource.update('t1', { title: 'X' } as any)).rejects.toThrow('Forbidden');
    });

    it('delete() propagates request errors', async () => {
      mockRequest.mockRejectedValue(new Error('Server error'));
      const resource = new InvoicesResource(mockRequest);
      await expect(resource.delete('inv1')).rejects.toThrow('Server error');
    });

    it('search() propagates request errors', async () => {
      mockRequest.mockRejectedValue(new Error('Timeout'));
      const resource = new ContactsResource(mockRequest);
      await expect(resource.search('query')).rejects.toThrow('Timeout');
    });

    it('bulkUpdate() propagates request errors', async () => {
      mockRequest.mockRejectedValue(new Error('Bulk limit exceeded'));
      const resource = new ContactsResource(mockRequest);
      await expect(resource.bulkUpdate(['id1'], { firstName: 'X' } as any)).rejects.toThrow('Bulk limit exceeded');
    });
  });
});
