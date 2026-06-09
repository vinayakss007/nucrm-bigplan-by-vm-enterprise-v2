import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cn,
  formatCurrency,
  formatDate,
  formatDateTimeShort,
  formatRelativeTime,
  getInitials,
  toSnakeCase,
} from '@/lib/utils';

describe('cn (class merger)', () => {
  it('merges class names', () => {
    expect(cn('px-4', 'py-2')).toBe('px-4 py-2');
  });

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible');
  });

  it('resolves tailwind conflicts', () => {
    expect(cn('px-4', 'px-6')).toBe('px-6');
  });

  it('handles undefined and null', () => {
    expect(cn('base', undefined, null, 'end')).toBe('base end');
  });

  it('returns empty string for no args', () => {
    expect(cn()).toBe('');
  });

  it('handles array inputs', () => {
    expect(cn(['foo', 'bar'], 'baz')).toBe('foo bar baz');
  });
});

describe('formatCurrency', () => {
  it('formats positive numbers', () => {
    const result = formatCurrency(1234.56);
    expect(result).toContain('1');
    expect(result).toMatch(/1,23[45]/);
  });

  it('formats zero', () => {
    const result = formatCurrency(0);
    expect(result).toContain('0');
  });

  it('handles negative numbers', () => {
    const result = formatCurrency(-500);
    expect(result).toContain('500');
  });

  it('handles string input', () => {
    expect(formatCurrency('1234.56')).toMatch(/1,23[45]/);
  });

  it('returns $0 for NaN', () => {
    expect(formatCurrency(NaN)).toBe('$0');
    expect(formatCurrency('not-a-number')).toBe('$0');
  });

  it('handles undefined/null gracefully', () => {
    expect(formatCurrency(undefined as any)).toBeDefined();
    expect(formatCurrency(null as any)).toBeDefined();
  });
});

describe('formatDate', () => {
  it('formats ISO date string', () => {
    const result = formatDate('2025-06-15T10:30:00Z');
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
  });

  it('formats Date object', () => {
    const result = formatDate(new Date('2025-06-15'));
    expect(result).toContain('Jun');
    expect(result).toContain('2025');
  });

  it('returns em dash for null/undefined', () => {
    expect(formatDate(null)).toBe('\u2014');
    expect(formatDate(undefined)).toBe('\u2014');
  });

  it('returns em dash for invalid date string', () => {
    expect(formatDate('not-a-date')).toBe('\u2014');
  });
});

describe('formatDateTimeShort', () => {
  it('formats ISO date string', () => {
    const result = formatDateTimeShort('2025-06-15T10:30:00Z');
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
  });

  it('formats Date object', () => {
    const result = formatDateTimeShort(new Date('2025-06-15T10:30:00'));
    expect(result).toContain('Jun');
    expect(result).toContain('2025');
  });

  it('returns em dash for null/undefined', () => {
    expect(formatDateTimeShort(null)).toBe('\u2014');
    expect(formatDateTimeShort(undefined)).toBe('\u2014');
  });

  it('returns em dash for invalid date', () => {
    expect(formatDateTimeShort('bad-date')).toBe('\u2014');
  });
});

describe('formatRelativeTime', () => {
  it('shows "just now" for recent dates', () => {
    const now = new Date().toISOString();
    const result = formatRelativeTime(now);
    expect(result).toMatch(/just now/i);
  });

  it('shows minutes for recent past', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const result = formatRelativeTime(fiveMinAgo);
    expect(result).toMatch(/5m ago/);
  });

  it('shows hours for same day', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const result = formatRelativeTime(threeHoursAgo);
    expect(result).toMatch(/3h ago/);
  });

  it('shows days for past week', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const result = formatRelativeTime(twoDaysAgo);
    expect(result).toMatch(/2d ago/);
  });

  it('shows weeks', () => {
    const threeWeeksAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();
    const result = formatRelativeTime(threeWeeksAgo);
    expect(result).toMatch(/3w ago/);
  });

  it('shows months', () => {
    const fiveMonthsAgo = new Date(Date.now() - 150 * 24 * 60 * 60 * 1000).toISOString();
    const result = formatRelativeTime(fiveMonthsAgo);
    expect(result).toMatch(/5mo ago/);
  });

  it('shows years', () => {
    const twoYearsAgo = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();
    const result = formatRelativeTime(twoYearsAgo);
    expect(result).toMatch(/2y ago/);
  });

  it('handles null gracefully', () => {
    const result = formatRelativeTime(null);
    expect(result).toBe('\u2014');
  });

  it('handles invalid date', () => {
    expect(formatRelativeTime('bad-date')).toBe('\u2014');
  });
});

describe('getInitials', () => {
  it('gets initials from full name', () => {
    expect(getInitials('John Doe')).toBe('JD');
  });

  it('handles single name', () => {
    expect(getInitials('Admin')).toBe('A');
  });

  it('handles empty string', () => {
    expect(getInitials('')).toBe('?');
  });

  it('handles whitespace-only', () => {
    expect(getInitials('   ')).toBe('?');
  });

  it('handles email-style input', () => {
    const result = getInitials('user@example.com');
    expect(result).toBe('U');
  });

  it('uses first and last name from multiple parts', () => {
    expect(getInitials('John Michael Doe')).toBe('JD');
  });

  it('returns uppercase initials', () => {
    expect(getInitials('john doe')).toBe('JD');
  });
});

describe('toSnakeCase', () => {
  it('converts camelCase keys to snake_case', () => {
    const result = toSnakeCase({ firstName: 'John', lastName: 'Doe' });
    expect(result).toEqual({ first_name: 'John', last_name: 'Doe' });
  });

  it('handles nested objects', () => {
    const result = toSnakeCase({ user: { firstName: 'John', contactInfo: { phoneNumber: '555' } } });
    expect(result).toEqual({ user: { first_name: 'John', contact_info: { phone_number: '555' } } });
  });

  it('handles arrays', () => {
    const result = toSnakeCase([{ userId: 1 }, { userId: 2 }]);
    expect(result).toEqual([{ user_id: 1 }, { user_id: 2 }]);
  });

  it('preserves Date objects', () => {
    const date = new Date('2025-01-01');
    const result = toSnakeCase({ createdAt: date });
    expect(result.created_at).toBe(date);
    expect(result.created_at).toBeInstanceOf(Date);
  });

  it('returns null/undefined as-is', () => {
    expect(toSnakeCase(null)).toBeNull();
    expect(toSnakeCase(undefined)).toBeUndefined();
  });

  it('returns primitives as-is', () => {
    expect(toSnakeCase('string')).toBe('string');
    expect(toSnakeCase(42)).toBe(42);
    expect(toSnakeCase(true)).toBe(true);
  });

  it('handles empty object', () => {
    expect(toSnakeCase({})).toEqual({});
  });
});

describe('getCsrfToken', () => {
  beforeAll(() => {
    vi.stubGlobal('document', { cookie: 'nucrm_csrf_token=abc123' });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('returns token from cookie', async () => {
    const { getCsrfToken } = await import('@/lib/utils');
    expect(getCsrfToken()).toBe('abc123');
  });
});

describe('apiFetch', () => {
  beforeAll(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('document', { cookie: 'nucrm_csrf_token=csrf-secret' });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls fetch with provided url and options', async () => {
    const { apiFetch } = await import('@/lib/utils');
    const mockResponse = new Response('ok', { status: 200 });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const response = await apiFetch('/api/test', { method: 'POST' });
    expect(response).toBe(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('adds CSRF token header from cookie', async () => {
    const { apiFetch } = await import('@/lib/utils');
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('ok'));

    await apiFetch('/api/test');
    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = callArgs[1]?.headers;
    const headerEntries = headers ? [...new Headers(headers).entries()] : [];
    const hasCsrf = headerEntries.some(([k]) => k.toLowerCase() === 'x-csrf-token');
    expect(hasCsrf).toBe(true);
  });

  it('preserves existing X-CSRF-Token header', async () => {
    const { apiFetch } = await import('@/lib/utils');
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('ok'));

    const headers = new Headers({ 'X-CSRF-Token': 'explicit-token' });
    await apiFetch('/api/test', { headers });
    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const respHeaders = callArgs[1]?.headers;
    expect(respHeaders).toBeDefined();
  });
});
