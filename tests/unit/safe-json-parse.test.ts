/**
 * Tests for lib/api/safe-json-parse.ts
 */
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/api/safe-json-parse';

function makeRequest(
  body: string,
  headers?: Record<string, string>,
): NextRequest {
  return new NextRequest('http://localhost/api/test', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

describe('parseJsonBody', () => {
  it('parses valid JSON object', async () => {
    const req = makeRequest('{"name": "Alice", "age": 30}');
    const result = await parseJsonBody(req);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ name: 'Alice', age: 30 });
    expect(result.rawSize).toBeGreaterThan(0);
  });

  it('rejects payload exceeding maxBytes (via Content-Length)', async () => {
    const req = makeRequest('{"x":1}', { 'content-length': '2000000' });
    const result = await parseJsonBody(req, { maxBytes: 1024 });

    expect(result.error).not.toBeNull();
    expect(result.error!.status).toBe(413);
    const body = await result.error!.json();
    expect(body.code).toBe('BODY_TOO_LARGE');
  });

  it('rejects payload exceeding maxBytes (actual size)', async () => {
    const large = JSON.stringify({ data: 'x'.repeat(2000) });
    const req = makeRequest(large);
    const result = await parseJsonBody(req, { maxBytes: 100 });

    expect(result.error).not.toBeNull();
    expect(result.error!.status).toBe(413);
  });

  it('rejects empty body', async () => {
    const req = makeRequest('');
    const result = await parseJsonBody(req);

    expect(result.error).not.toBeNull();
    expect(result.error!.status).toBe(400);
    const body = await result.error!.json();
    expect(body.code).toBe('BODY_EMPTY');
  });

  it('rejects whitespace-only body', async () => {
    const req = makeRequest('   \n\t  ');
    const result = await parseJsonBody(req);

    expect(result.error).not.toBeNull();
    expect(result.error!.status).toBe(400);
    const body = await result.error!.json();
    expect(body.code).toBe('BODY_EMPTY');
  });

  it('rejects malformed JSON', async () => {
    const req = makeRequest('{name: invalid}');
    const result = await parseJsonBody(req);

    expect(result.error).not.toBeNull();
    expect(result.error!.status).toBe(400);
    const body = await result.error!.json();
    expect(body.code).toBe('INVALID_JSON');
    expect(body.error).toContain('Malformed JSON');
  });

  it('rejects arrays by default', async () => {
    const req = makeRequest('[1, 2, 3]');
    const result = await parseJsonBody(req);

    expect(result.error).not.toBeNull();
    expect(result.error!.status).toBe(400);
    const body = await result.error!.json();
    expect(body.code).toBe('INVALID_TYPE');
    expect(body.error).toContain('not an array');
  });

  it('allows arrays when allowArray=true', async () => {
    const req = makeRequest('[1, 2, 3]');
    const result = await parseJsonBody(req, { allowArray: true });

    expect(result.error).toBeNull();
    expect(result.data).toEqual([1, 2, 3]);
  });

  it('rejects primitive values by default', async () => {
    const req = makeRequest('"just a string"');
    const result = await parseJsonBody(req);

    expect(result.error).not.toBeNull();
    expect(result.error!.status).toBe(400);
  });

  it('allows primitives when allowPrimitive=true', async () => {
    const req = makeRequest('42');
    const result = await parseJsonBody(req, { allowPrimitive: true });

    expect(result.error).toBeNull();
    expect(result.data).toBe(42);
  });

  it('rejects null by default', async () => {
    const req = makeRequest('null');
    const result = await parseJsonBody(req);

    expect(result.error).not.toBeNull();
    expect(result.error!.status).toBe(400);
  });

  it('reports rawSize correctly', async () => {
    const body = '{"hello": "world"}';
    const req = makeRequest(body);
    const result = await parseJsonBody(req);

    expect(result.rawSize).toBe(Buffer.byteLength(body, 'utf-8'));
  });

  it('handles unicode correctly for size calculation', async () => {
    const body = '{"emoji": "🎉🎊🎈"}';
    const req = makeRequest(body);
    const result = await parseJsonBody(req);

    expect(result.error).toBeNull();
    // Each emoji is 4 bytes in UTF-8
    expect(result.rawSize).toBeGreaterThan(body.length);
  });

  it('works with nested objects', async () => {
    const body = '{"user": {"name": "Bob", "contacts": [1, 2, 3]}}';
    const req = makeRequest(body);
    const result = await parseJsonBody(req);

    expect(result.error).toBeNull();
    expect((result.data as Record<string, unknown>)['user']).toBeDefined();
  });

  it('default maxBytes is 1MB', async () => {
    // Just under 1MB should pass
    const body = JSON.stringify({ data: 'x'.repeat(900_000) });
    const req = makeRequest(body);
    const result = await parseJsonBody(req);

    expect(result.error).toBeNull();
  });
});
