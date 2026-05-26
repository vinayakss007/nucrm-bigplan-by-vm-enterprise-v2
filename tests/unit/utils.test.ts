/**
 * Utility Function Tests
 *
 * Tests for lib/utils.ts — formatters, validators, helpers.
 */
import { describe, it, expect } from 'vitest';
import { cn, formatCurrency, formatDate, formatRelativeTime, getInitials } from '@/lib/utils';

describe('cn (class merger)', () => {
  it('merges class names', () => {
    expect(cn('px-4', 'py-2')).toBe('px-4 py-2');
  });

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible');
  });

  it('resolves tailwind conflicts', () => {
    const result = cn('px-4', 'px-6');
    expect(result).toBe('px-6');
  });

  it('handles undefined and null', () => {
    expect(cn('base', undefined, null, 'end')).toBe('base end');
  });

  it('returns empty string for no args', () => {
    expect(cn()).toBe('');
  });
});

describe('formatCurrency', () => {
  it('formats positive numbers', () => {
    const result = formatCurrency(1234.56);
    expect(result).toContain('1');
    expect(result).toContain('234');
  });

  it('formats zero', () => {
    const result = formatCurrency(0);
    expect(result).toContain('0');
  });

  it('handles negative numbers', () => {
    const result = formatCurrency(-500);
    expect(result).toContain('500');
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

  it('handles null/undefined', () => {
    expect(formatDate(null as any)).toBe('—');
    expect(formatDate(undefined as any)).toBe('—');
  });
});

describe('getInitials', () => {
  it('gets initials from full name', () => {
    expect(getInitials('John Doe')).toBe('JD');
  });

  it('handles single name', () => {
    const result = getInitials('Admin');
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles empty string', () => {
    const result = getInitials('');
    expect(result).toBeDefined();
  });

  it('handles email-style input', () => {
    const result = getInitials('user@example.com');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('formatRelativeTime', () => {
  it('shows "just now" for recent dates', () => {
    const now = new Date().toISOString();
    const result = formatRelativeTime(now);
    expect(result.toLowerCase()).toMatch(/just now|seconds?|moment/i);
  });

  it('shows minutes for recent past', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const result = formatRelativeTime(fiveMinAgo);
    expect(result).toMatch(/min/i);
  });

  it('shows hours for same day', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const result = formatRelativeTime(threeHoursAgo);
    expect(result).toMatch(/hour|hr/i);
  });

  it('handles null gracefully', () => {
    const result = formatRelativeTime(null as any);
    expect(result).toBeDefined();
  });
});
