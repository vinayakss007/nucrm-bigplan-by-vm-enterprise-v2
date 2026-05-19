import { describe, it, expect } from 'vitest';
import { cn, formatCurrency, formatDate, formatDateTimeShort, formatRelativeTime, getInitials } from '@/lib/utils';

describe('utils', () => {
  describe('cn', () => {
    it('merges class names correctly', () => {
      expect(cn('foo', 'bar')).toBe('foo bar');
      expect(cn('foo', { bar: true, baz: false })).toBe('foo bar');
      expect(cn('foo', null, undefined, 'bar')).toBe('foo bar');
    });

    it('handles tailwind conflicts', () => {
      expect(cn('px-2', 'px-4')).toBe('px-4');
    });
  });

  describe('formatCurrency', () => {
    it('formats numbers as currency', () => {
      expect(formatCurrency(1234)).toBe('$1,234');
      expect(formatCurrency(1234.56)).toBe('$1,235');
      expect(formatCurrency(0)).toBe('$0');
    });

    it('handles string inputs', () => {
      expect(formatCurrency('1234')).toBe('$1,234');
      expect(formatCurrency('0')).toBe('$0');
    });

    it('handles invalid input', () => {
      expect(formatCurrency(NaN)).toBe('$0');
      expect(formatCurrency('invalid')).toBe('$0');
    });
  });

  describe('formatDate', () => {
    it('formats date objects', () => {
      const date = new Date('2024-01-15');
      expect(formatDate(date)).toContain('2024');
      expect(formatDate(date)).toContain('Jan');
    });

    it('formats date strings', () => {
      expect(formatDate('2024-01-15')).toContain('2024');
    });

    it('handles invalid dates', () => {
      expect(formatDate('invalid')).toBe('—');
      expect(formatDate(new Date(NaN))).toBe('—');
    });
  });

  describe('formatDateTimeShort', () => {
    it('formats date with time', () => {
      const date = new Date('2024-01-15T10:30:00');
      const formatted = formatDateTimeShort(date);
      expect(formatted).toContain('2024');
      expect(formatted).toContain('Jan');
    });

    it('handles invalid dates', () => {
      expect(formatDateTimeShort('invalid')).toBe('—');
    });
  });

  describe('formatRelativeTime', () => {
    it('shows "just now" for recent times', () => {
      const now = new Date();
      expect(formatRelativeTime(now)).toBe('just now');
    });

    it('shows minutes ago', () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      expect(formatRelativeTime(fiveMinAgo)).toBe('5m ago');
    });

    it('shows hours ago', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago');
    });

    it('shows days ago', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      expect(formatRelativeTime(threeDaysAgo)).toBe('3d ago');
    });

    it('shows weeks ago', () => {
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      expect(formatRelativeTime(twoWeeksAgo)).toBe('2w ago');
    });

    it('shows months ago', () => {
      const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      expect(formatRelativeTime(twoMonthsAgo)).toBe('2mo ago');
    });

    it('shows years ago', () => {
      const twoYearsAgo = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000);
      expect(formatRelativeTime(twoYearsAgo)).toBe('2y ago');
    });

    it('handles invalid dates', () => {
      expect(formatRelativeTime('invalid')).toBe('—');
    });
  });

  describe('getInitials', () => {
    it('returns initials for full name', () => {
      expect(getInitials('John Doe')).toBe('JD');
    });

    it('returns first letter for single name', () => {
      expect(getInitials('John')).toBe('J');
    });

    it('handles empty or whitespace', () => {
      expect(getInitials('')).toBe('?');
      expect(getInitials('   ')).toBe('?');
    });

    it('handles multiple words', () => {
      expect(getInitials('John Middle Doe')).toBe('JD');
    });
  });
});
