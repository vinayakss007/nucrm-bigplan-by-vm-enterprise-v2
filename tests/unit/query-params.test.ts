/**
 * Tests for lib/api/query-params.ts
 */
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { parseQueryParams } from '@/lib/api/query-params';

function makeRequest(queryString: string): NextRequest {
  return new NextRequest(`http://localhost/api/test?${queryString}`);
}

describe('parseQueryParams', () => {
  describe('sort', () => {
    it('parses single sort field', () => {
      const req = makeRequest('sort=createdAt:desc');
      const params = parseQueryParams(req);
      expect(params.sort).toEqual([{ field: 'createdAt', direction: 'desc' }]);
    });

    it('parses multiple sort fields', () => {
      const req = makeRequest('sort=name:asc,createdAt:desc');
      const params = parseQueryParams(req);
      expect(params.sort).toEqual([
        { field: 'name', direction: 'asc' },
        { field: 'createdAt', direction: 'desc' },
      ]);
    });

    it('defaults direction to asc', () => {
      const req = makeRequest('sort=name');
      const params = parseQueryParams(req);
      expect(params.sort).toEqual([{ field: 'name', direction: 'asc' }]);
    });

    it('uses defaultSort when no sort provided', () => {
      const req = makeRequest('');
      const params = parseQueryParams(req, {
        defaultSort: [{ field: 'updatedAt', direction: 'desc' }],
      });
      expect(params.sort).toEqual([{ field: 'updatedAt', direction: 'desc' }]);
    });

    it('respects allowedSorts whitelist', () => {
      const req = makeRequest('sort=hackField:desc,name:asc');
      const params = parseQueryParams(req, { allowedSorts: ['name', 'createdAt'] });
      expect(params.sort).toEqual([{ field: 'name', direction: 'asc' }]);
    });

    it('limits to maxSorts', () => {
      const req = makeRequest('sort=a:asc,b:asc,c:asc,d:asc');
      const params = parseQueryParams(req, { maxSorts: 2 });
      expect(params.sort).toHaveLength(2);
    });

    it('sanitizes field names', () => {
      const req = makeRequest('sort=drop table;:desc');
      const params = parseQueryParams(req);
      expect(params.sort[0]!.field).toBe('droptable');
    });
  });

  describe('filters', () => {
    it('parses filter[field]=value', () => {
      const req = makeRequest('filter[status]=active');
      const params = parseQueryParams(req);
      expect(params.filters).toEqual([{ field: 'status', value: 'active', operator: 'eq' }]);
    });

    it('parses filter with operator', () => {
      const req = makeRequest('filter[amount][gte]=1000');
      const params = parseQueryParams(req);
      expect(params.filters).toEqual([{ field: 'amount', value: '1000', operator: 'gte' }]);
    });

    it('supports multiple filters', () => {
      const req = makeRequest('filter[status]=active&filter[type]=lead');
      const params = parseQueryParams(req);
      expect(params.filters).toHaveLength(2);
    });

    it('respects allowedFilters whitelist', () => {
      const req = makeRequest('filter[status]=active&filter[secret]=hidden');
      const params = parseQueryParams(req, { allowedFilters: ['status'] });
      expect(params.filters).toHaveLength(1);
      expect(params.filters[0]!.field).toBe('status');
    });

    it('limits to maxFilters', () => {
      const req = makeRequest('filter[a]=1&filter[b]=2&filter[c]=3');
      const params = parseQueryParams(req, { maxFilters: 2 });
      expect(params.filters).toHaveLength(2);
    });

    it('defaults operator to eq for invalid operators', () => {
      const req = makeRequest('filter[name][invalid]=test');
      const params = parseQueryParams(req);
      expect(params.filters[0]!.operator).toBe('eq');
    });

    it('supports in operator', () => {
      const req = makeRequest('filter[status][in]=active,pending');
      const params = parseQueryParams(req);
      expect(params.filters[0]).toEqual({ field: 'status', value: 'active,pending', operator: 'in' });
    });
  });

  describe('fields', () => {
    it('parses comma-separated fields', () => {
      const req = makeRequest('fields=id,name,email');
      const params = parseQueryParams(req);
      expect(params.fields).toEqual(['id', 'name', 'email']);
    });

    it('returns empty array when no fields specified', () => {
      const req = makeRequest('');
      const params = parseQueryParams(req);
      expect(params.fields).toEqual([]);
    });

    it('respects allowedFields whitelist', () => {
      const req = makeRequest('fields=id,name,secret_key');
      const params = parseQueryParams(req, { allowedFields: ['id', 'name', 'email'] });
      expect(params.fields).toEqual(['id', 'name']);
    });

    it('sanitizes field names', () => {
      const req = makeRequest('fields=id,na;me,email');
      const params = parseQueryParams(req);
      expect(params.fields).toEqual(['id', 'name', 'email']);
    });
  });

  describe('search', () => {
    it('parses q parameter', () => {
      const req = makeRequest('q=hello+world');
      const params = parseQueryParams(req);
      expect(params.search).toBe('hello world');
    });

    it('parses search parameter', () => {
      const req = makeRequest('search=test');
      const params = parseQueryParams(req);
      expect(params.search).toBe('test');
    });

    it('returns null when no search', () => {
      const req = makeRequest('');
      const params = parseQueryParams(req);
      expect(params.search).toBeNull();
    });

    it('q takes precedence over search', () => {
      const req = makeRequest('q=first&search=second');
      const params = parseQueryParams(req);
      expect(params.search).toBe('first');
    });
  });

  describe('pagination', () => {
    it('defaults to page 1, limit 50', () => {
      const req = makeRequest('');
      const params = parseQueryParams(req);
      expect(params.pagination).toEqual({ page: 1, limit: 50, offset: 0 });
    });

    it('respects page and limit', () => {
      const req = makeRequest('page=3&limit=25');
      const params = parseQueryParams(req);
      expect(params.pagination).toEqual({ page: 3, limit: 25, offset: 50 });
    });

    it('clamps limit to maxLimit', () => {
      const req = makeRequest('limit=500');
      const params = parseQueryParams(req);
      expect(params.pagination.limit).toBe(200);
    });

    it('custom maxLimit', () => {
      const req = makeRequest('limit=100');
      const params = parseQueryParams(req, { maxLimit: 50 });
      expect(params.pagination.limit).toBe(50);
    });

    it('custom defaultLimit', () => {
      const req = makeRequest('');
      const params = parseQueryParams(req, { defaultLimit: 25 });
      expect(params.pagination.limit).toBe(25);
    });

    it('page 0 becomes page 1', () => {
      const req = makeRequest('page=0');
      const params = parseQueryParams(req);
      expect(params.pagination.page).toBe(1);
      expect(params.pagination.offset).toBe(0);
    });

    it('negative page becomes page 1', () => {
      const req = makeRequest('page=-5');
      const params = parseQueryParams(req);
      expect(params.pagination.page).toBe(1);
    });

    it('invalid limit uses default', () => {
      const req = makeRequest('limit=abc');
      const params = parseQueryParams(req);
      expect(params.pagination.limit).toBe(50);
    });
  });

  describe('combined', () => {
    it('parses all params together', () => {
      const req = makeRequest(
        'sort=name:asc&filter[status]=active&fields=id,name&q=hello&page=2&limit=20',
      );
      const params = parseQueryParams(req, {
        allowedSorts: ['name', 'createdAt'],
        allowedFilters: ['status', 'type'],
      });

      expect(params.sort).toEqual([{ field: 'name', direction: 'asc' }]);
      expect(params.filters).toEqual([{ field: 'status', value: 'active', operator: 'eq' }]);
      expect(params.fields).toEqual(['id', 'name']);
      expect(params.search).toBe('hello');
      expect(params.pagination).toEqual({ page: 2, limit: 20, offset: 20 });
    });
  });
});
