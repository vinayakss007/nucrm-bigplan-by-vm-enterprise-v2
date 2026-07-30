/**
 * Tests for lib/api/etag.ts
 */
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { generateETag, withETag, withVersionETag } from '@/lib/api/etag';

function makeRequest(ifNoneMatch?: string): NextRequest {
  const headers = new Headers();
  if (ifNoneMatch) {
    headers.set('if-none-match', ifNoneMatch);
  }
  return new NextRequest('http://localhost/api/test', { headers });
}

describe('generateETag', () => {
  it('produces a weak ETag string', () => {
    const etag = generateETag({ name: 'test' });
    expect(etag).toMatch(/^W\/"[a-z0-9]+"$/);
  });

  it('is deterministic for same data', () => {
    const data = { contacts: [{ id: 1, name: 'Alice' }] };
    expect(generateETag(data)).toBe(generateETag(data));
  });

  it('changes when data changes', () => {
    const etag1 = generateETag({ count: 1 });
    const etag2 = generateETag({ count: 2 });
    expect(etag1).not.toBe(etag2);
  });

  it('handles empty objects', () => {
    const etag = generateETag({});
    expect(etag).toMatch(/^W\/"[a-z0-9]+"$/);
  });

  it('handles arrays', () => {
    const etag = generateETag([1, 2, 3]);
    expect(etag).toMatch(/^W\/"[a-z0-9]+"$/);
  });

  it('handles null', () => {
    const etag = generateETag(null);
    expect(etag).toMatch(/^W\/"[a-z0-9]+"$/);
  });
});

describe('withETag', () => {
  it('returns 200 with ETag header when no If-None-Match', async () => {
    const req = makeRequest();
    const data = { contacts: [{ id: '1', name: 'Alice' }] };

    const response = withETag(req, data);

    expect(response.status).toBe(200);
    expect(response.headers.get('ETag')).toMatch(/^W\/"[a-z0-9]+"$/);
    const body = await response.json();
    expect(body.contacts[0].name).toBe('Alice');
  });

  it('returns 304 when If-None-Match matches', () => {
    const data = { contacts: [{ id: '1', name: 'Alice' }] };
    const etag = generateETag(data);
    const req = makeRequest(etag);

    const response = withETag(req, data);

    expect(response.status).toBe(304);
    expect(response.headers.get('ETag')).toBe(etag);
  });

  it('returns 200 when If-None-Match does not match', async () => {
    const req = makeRequest('W/"stale-etag"');
    const data = { contacts: [{ id: '1', name: 'Bob' }] };

    const response = withETag(req, data);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.contacts[0].name).toBe('Bob');
  });

  it('respects custom status code', async () => {
    const req = makeRequest();
    const data = { created: true };

    const response = withETag(req, data, { status: 201 });

    expect(response.status).toBe(201);
  });

  it('applies additional headers', () => {
    const req = makeRequest();
    const data = { ok: true };

    const response = withETag(req, data, {
      headers: { 'X-Custom': 'value' },
    });

    expect(response.headers.get('X-Custom')).toBe('value');
    expect(response.headers.get('ETag')).toBeTruthy();
  });
});

describe('withVersionETag', () => {
  it('generates ETag from version string', () => {
    const req = makeRequest();
    const data = { items: [] };

    const response = withVersionETag(req, data, '2024-01-15T10:00:00Z');

    expect(response.status).toBe(200);
    expect(response.headers.get('ETag')).toMatch(/^W\/"v-.+"$/);
  });

  it('returns 304 when version ETag matches', () => {
    const version = '2024-01-15T10:00:00Z';
    const etag = `W/"v-${version}"`;
    const req = makeRequest(etag);
    const data = { items: [] };

    const response = withVersionETag(req, data, version);

    expect(response.status).toBe(304);
  });

  it('accepts Date objects as version', () => {
    const date = new Date('2024-06-01T12:00:00Z');
    const expectedEtag = `W/"v-${date.getTime().toString(36)}"`;
    const req = makeRequest(expectedEtag);
    const data = { items: [] };

    const response = withVersionETag(req, data, date);

    expect(response.status).toBe(304);
  });

  it('accepts numbers as version', () => {
    const req = makeRequest('W/"v-42"');
    const data = { items: [] };

    const response = withVersionETag(req, data, 42);

    expect(response.status).toBe(304);
  });

  it('returns 200 when version does not match', async () => {
    const req = makeRequest('W/"v-old-version"');
    const data = { items: [1, 2, 3] };

    const response = withVersionETag(req, data, 'new-version');

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([1, 2, 3]);
  });
});
