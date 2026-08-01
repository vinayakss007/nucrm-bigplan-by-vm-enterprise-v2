import { describe, it, expect } from 'vitest';
import {
  envelope,
  paginatedEnvelope,
  errorEnvelope,
} from '@/lib/api/response-envelope';

describe('lib/api/response-envelope', () => {
  describe('envelope', () => {
    it('wraps data in { data } shape', () => {
      const result = envelope({ name: 'test' });
      expect(result).toEqual({ data: { name: 'test' } });
    });

    it('wraps an array value', () => {
      const result = envelope([1, 2, 3]);
      expect(result).toEqual({ data: [1, 2, 3] });
    });

    it('wraps null value', () => {
      const result = envelope(null);
      expect(result).toEqual({ data: null });
    });

    it('wraps a string value', () => {
      const result = envelope('hello');
      expect(result).toEqual({ data: 'hello' });
    });
  });

  describe('paginatedEnvelope', () => {
    it('returns correct shape with pagination meta', () => {
      const result = paginatedEnvelope([1, 2, 3], { page: 1, limit: 10, total: 3 });
      expect(result).toEqual({
        data: [1, 2, 3],
        meta: {
          page: 1,
          limit: 10,
          total: 3,
          totalPages: 1,
        },
      });
    });

    it('calculates totalPages correctly', () => {
      const result = paginatedEnvelope([], { page: 2, limit: 10, total: 25 });
      expect(result.meta.totalPages).toBe(3);
    });

    it('handles zero total gracefully', () => {
      const result = paginatedEnvelope([], { page: 1, limit: 10, total: 0 });
      expect(result.meta.totalPages).toBe(0);
    });

    it('handles limit of 0 without division by zero', () => {
      const result = paginatedEnvelope([], { page: 1, limit: 0, total: 50 });
      // Math.max(limit, 1) prevents division by zero
      expect(result.meta.totalPages).toBe(50);
    });

    it('wraps complex objects', () => {
      const items = [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ];
      const result = paginatedEnvelope(items, { page: 1, limit: 20, total: 2 });
      expect(result.data).toEqual(items);
      expect(result.meta.total).toBe(2);
    });
  });

  describe('errorEnvelope', () => {
    it('produces correct error shape without details', () => {
      const result = errorEnvelope('NOT_FOUND', 'Resource not found');
      expect(result).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found',
        },
      });
    });

    it('includes details when provided', () => {
      const details = { field: 'email', reason: 'invalid format' };
      const result = errorEnvelope('VALIDATION_ERROR', 'Invalid input', details);
      expect(result).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: { field: 'email', reason: 'invalid format' },
        },
      });
    });

    it('does not include details key when undefined', () => {
      const result = errorEnvelope('INTERNAL', 'Something went wrong');
      expect(result.error).not.toHaveProperty('details');
    });

    it('allows null as details value', () => {
      const result = errorEnvelope('BAD_REQUEST', 'Bad', null);
      expect(result.error.details).toBeNull();
    });
  });
});
