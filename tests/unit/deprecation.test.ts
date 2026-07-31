/**
 * Tests for lib/api/deprecation.ts
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import {
  withDeprecation,
  registerDeprecation,
  getDeprecatedEndpoints,
  isDeprecated,
  clearDeprecationRegistry,
} from '@/lib/api/deprecation';

describe('withDeprecation', () => {
  it('sets Deprecation: true when no since date provided', () => {
    const response = NextResponse.json({ data: [] });
    const result = withDeprecation(response);

    expect(result.headers.get('Deprecation')).toBe('true');
  });

  it('sets Deprecation header with date when since provided', () => {
    const since = new Date('2024-06-01T00:00:00Z');
    const response = NextResponse.json({ data: [] });
    const result = withDeprecation(response, { since });

    expect(result.headers.get('Deprecation')).toBe(since.toUTCString());
  });

  it('sets Sunset header when sunset date provided', () => {
    const sunset = new Date('2025-03-01T00:00:00Z');
    const response = NextResponse.json({ data: [] });
    const result = withDeprecation(response, { sunset });

    expect(result.headers.get('Sunset')).toBe(sunset.toUTCString());
  });

  it('sets Link header to successor', () => {
    const response = NextResponse.json({ data: [] });
    const result = withDeprecation(response, {
      successor: '/api/v2/contacts',
    });

    expect(result.headers.get('Link')).toBe('</api/v2/contacts>; rel="successor-version"');
  });

  it('sets X-Deprecation-Notice with custom message', () => {
    const response = NextResponse.json({ data: [] });
    const result = withDeprecation(response, {
      message: 'Use /api/v2/contacts instead',
    });

    expect(result.headers.get('X-Deprecation-Notice')).toBe('Use /api/v2/contacts instead');
  });

  it('sets all headers together', () => {
    const since = new Date('2024-01-01T00:00:00Z');
    const sunset = new Date('2025-06-01T00:00:00Z');
    const response = NextResponse.json({ data: [] });

    const result = withDeprecation(response, {
      since,
      sunset,
      successor: '/api/v2/deals',
      message: 'Migrate to v2',
    });

    expect(result.headers.get('Deprecation')).toBe(since.toUTCString());
    expect(result.headers.get('Sunset')).toBe(sunset.toUTCString());
    expect(result.headers.get('Link')).toBe('</api/v2/deals>; rel="successor-version"');
    expect(result.headers.get('X-Deprecation-Notice')).toBe('Migrate to v2');
  });

  it('does not set optional headers when not provided', () => {
    const response = NextResponse.json({ ok: true });
    const result = withDeprecation(response);

    expect(result.headers.get('Deprecation')).toBe('true');
    expect(result.headers.get('Sunset')).toBeNull();
    expect(result.headers.get('Link')).toBeNull();
    expect(result.headers.get('X-Deprecation-Notice')).toBeNull();
  });

  it('preserves existing response body and status', async () => {
    const response = NextResponse.json({ contacts: [1, 2, 3] }, { status: 200 });
    const result = withDeprecation(response, { message: 'Old API' });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.contacts).toEqual([1, 2, 3]);
  });
});

describe('deprecation registry', () => {
  beforeEach(() => {
    clearDeprecationRegistry();
  });

  it('registers a deprecated endpoint', () => {
    registerDeprecation({
      path: '/api/v1/contacts',
      method: 'GET',
      since: '2024-01-01',
      sunset: '2025-06-01',
      successor: '/api/v2/contacts',
    });

    const endpoints = getDeprecatedEndpoints();
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]!.path).toBe('/api/v1/contacts');
  });

  it('checks if specific endpoint is deprecated', () => {
    registerDeprecation({
      path: '/api/v1/deals',
      method: 'POST',
      since: '2024-03-01',
    });

    expect(isDeprecated('POST', '/api/v1/deals')).not.toBeNull();
    expect(isDeprecated('GET', '/api/v1/deals')).toBeNull();
    expect(isDeprecated('POST', '/api/v2/deals')).toBeNull();
  });

  it('returns all registered endpoints', () => {
    registerDeprecation({ path: '/a', method: 'GET', since: '2024-01-01' });
    registerDeprecation({ path: '/b', method: 'POST', since: '2024-02-01' });
    registerDeprecation({ path: '/c', method: 'DELETE', since: '2024-03-01' });

    expect(getDeprecatedEndpoints()).toHaveLength(3);
  });

  it('clearDeprecationRegistry removes all entries', () => {
    registerDeprecation({ path: '/a', method: 'GET', since: '2024-01-01' });
    expect(getDeprecatedEndpoints()).toHaveLength(1);

    clearDeprecationRegistry();
    expect(getDeprecatedEndpoints()).toHaveLength(0);
  });

  it('overwrites duplicate registrations', () => {
    registerDeprecation({ path: '/api/x', method: 'GET', since: '2024-01-01' });
    registerDeprecation({ path: '/api/x', method: 'GET', since: '2024-06-01', sunset: '2025-01-01' });

    const endpoints = getDeprecatedEndpoints();
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]!.since).toBe('2024-06-01');
    expect(endpoints[0]!.sunset).toBe('2025-01-01');
  });
});
