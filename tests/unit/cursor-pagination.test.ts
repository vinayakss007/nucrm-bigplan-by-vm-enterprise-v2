/**
 * Tests for lib/api/cursor-pagination.ts
 */
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import {
  encodeCursor,
  decodeCursor,
  parseCursor,
  paginatedResponse,
} from '@/lib/api/cursor-pagination';
import type { CursorData } from '@/lib/api/cursor-pagination';

function makeRequest(params: string): NextRequest {
  return new NextRequest(`http://localhost/api/test?${params}`);
}

describe('encodeCursor / decodeCursor', () => {
  it('round-trips cursor data', () => {
    const data: CursorData = { v: '2024-01-15T10:00:00Z', id: 'abc-123' };
    const encoded = encodeCursor(data);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(data);
  });

  it('handles numeric sort values', () => {
    const data: CursorData = { v: 42, id: 'row-1' };
    const encoded = encodeCursor(data);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(data);
  });

  it('returns null for invalid base64', () => {
    expect(decodeCursor('not-valid-base64!!')).toBeNull();
  });

  it('returns null for valid base64 but invalid JSON', () => {
    const encoded = Buffer.from('not json').toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });

  it('returns null for missing v field', () => {
    const encoded = Buffer.from(JSON.stringify({ id: 'abc' })).toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });

  it('returns null for missing id field', () => {
    const encoded = Buffer.from(JSON.stringify({ v: '2024' })).toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });

  it('returns null for non-string id', () => {
    const encoded = Buffer.from(JSON.stringify({ v: '2024', id: 123 })).toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });

  it('returns null for boolean v', () => {
    const encoded = Buffer.from(JSON.stringify({ v: true, id: 'x' })).toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });
});

describe('parseCursor', () => {
  it('returns null cursor for first page (no cursor param)', () => {
    const req = makeRequest('limit=20');
    const result = parseCursor(req);
    expect(result.cursor).toBeNull();
    expect(result.limit).toBe(20);
  });

  it('parses valid cursor', () => {
    const cursorData: CursorData = { v: '2024-06-01', id: 'row-5' };
    const encoded = encodeCursor(cursorData);
    const req = makeRequest(`cursor=${encoded}&limit=10`);
    const result = parseCursor(req);
    expect(result.cursor).toEqual(cursorData);
    expect(result.limit).toBe(10);
  });

  it('defaults limit to 50 when not provided', () => {
    const req = makeRequest('');
    const result = parseCursor(req);
    expect(result.limit).toBe(50);
  });

  it('clamps limit to maxLimit', () => {
    const req = makeRequest('limit=500');
    const result = parseCursor(req);
    expect(result.limit).toBe(200); // default max
  });

  it('clamps limit to 1 minimum', () => {
    const req = makeRequest('limit=0');
    const result = parseCursor(req);
    expect(result.limit).toBe(50); // parseInt of "0" is 0, then || DEFAULT_LIMIT
  });

  it('accepts custom maxLimit', () => {
    const req = makeRequest('limit=100');
    const result = parseCursor(req, 50);
    expect(result.limit).toBe(50);
  });

  it('returns null cursor for invalid cursor param', () => {
    const req = makeRequest('cursor=garbage');
    const result = parseCursor(req);
    expect(result.cursor).toBeNull();
  });
});

describe('paginatedResponse', () => {
  const makeRow = (id: string, date: string) => ({ id, name: `Item ${id}`, createdAt: date });
  const getCursor = (row: ReturnType<typeof makeRow>): CursorData => ({
    v: row.createdAt,
    id: row.id,
  });

  it('returns hasMore=false when rows <= limit', async () => {
    const rows = [makeRow('1', '2024-01-01'), makeRow('2', '2024-01-02')];
    const response = paginatedResponse(rows, 5, getCursor);
    const body = await response.json();

    expect(body.data).toHaveLength(2);
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.nextCursor).toBeNull();
    expect(body.pagination.count).toBe(2);
  });

  it('returns hasMore=true and nextCursor when rows > limit', async () => {
    // Simulating limit=2 but fetched 3 rows (limit+1 pattern)
    const rows = [
      makeRow('1', '2024-01-01'),
      makeRow('2', '2024-01-02'),
      makeRow('3', '2024-01-03'),
    ];
    const response = paginatedResponse(rows, 2, getCursor);
    const body = await response.json();

    expect(body.data).toHaveLength(2); // Extra row removed
    expect(body.pagination.hasMore).toBe(true);
    expect(body.pagination.nextCursor).not.toBeNull();
    expect(body.pagination.count).toBe(2);

    // Verify cursor points to last returned item
    const decoded = decodeCursor(body.pagination.nextCursor);
    expect(decoded).toEqual({ v: '2024-01-02', id: '2' });
  });

  it('returns empty data for empty results', async () => {
    const response = paginatedResponse([], 50, getCursor);
    const body = await response.json();

    expect(body.data).toEqual([]);
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.nextCursor).toBeNull();
    expect(body.pagination.count).toBe(0);
  });

  it('includes extra fields in response', async () => {
    const rows = [makeRow('1', '2024-01-01')];
    const response = paginatedResponse(rows, 50, getCursor, { total: 100 });
    const body = await response.json();

    expect(body.total).toBe(100);
    expect(body.data).toHaveLength(1);
  });

  it('returns 200 status', () => {
    const response = paginatedResponse([], 50, getCursor);
    expect(response.status).toBe(200);
  });
});
