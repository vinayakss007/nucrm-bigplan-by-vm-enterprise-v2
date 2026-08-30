import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the SQL passed to db.execute so we can assert on the compiled query.
const executeMock = vi.fn().mockResolvedValue({ rows: [{ id: 'a' }, { id: 'b' }] });

vi.mock('@/drizzle/db', () => ({
  db: { execute: (q: unknown) => executeMock(q) },
}));

import { PgDialect } from 'drizzle-orm/pg-core';
import {
  evaluateSegment,
  validateSegmentConfig,
  isSegmentEntityType,
  SegmentFilterError,
} from '@/lib/segments/evaluate';

// Render a drizzle SQL object to {text, params} using Drizzle's PUBLIC dialect
// API (the same path the DB driver uses). Asserting on `params` proves values
// are BOUND parameters rather than concatenated into the SQL text.
const dialect = new PgDialect();
function renderSql(q: unknown): { text: string; params: unknown[] } {
  const built = dialect.sqlToQuery(q as never);
  return { text: built.sql, params: built.params };
}

describe('segment evaluate — safety & compilation', () => {
  beforeEach(() => {
    executeMock.mockClear();
    executeMock.mockResolvedValue({ rows: [{ id: 'a' }, { id: 'b' }] });
  });

  describe('isSegmentEntityType', () => {
    it('accepts the 4 known types and rejects others', () => {
      expect(isSegmentEntityType('contact')).toBe(true);
      expect(isSegmentEntityType('company')).toBe(true);
      expect(isSegmentEntityType('lead')).toBe(true);
      expect(isSegmentEntityType('deal')).toBe(true);
      expect(isSegmentEntityType('user')).toBe(false);
      expect(isSegmentEntityType('contacts')).toBe(false); // plural not accepted
    });
  });

  describe('validateSegmentConfig — allowlist enforcement', () => {
    it('rejects an unknown field', () => {
      expect(() =>
        validateSegmentConfig('contact', { rules: [{ field: 'password', operator: 'eq', value: 'x' }] }),
      ).toThrow(SegmentFilterError);
    });

    it('rejects a field-injection attempt as an unknown field', () => {
      expect(() =>
        validateSegmentConfig('contact', {
          rules: [{ field: 'email; DROP TABLE contacts;--', operator: 'eq', value: 'x' }],
        }),
      ).toThrow(SegmentFilterError);
    });

    it('rejects an operator not allowed for the field kind', () => {
      // score is numeric; "contains" is a text-only operator.
      expect(() =>
        validateSegmentConfig('contact', { rules: [{ field: 'score', operator: 'contains' as never, value: 5 }] }),
      ).toThrow(SegmentFilterError);
    });

    it('accepts a valid rule set and defaults match to "all"', () => {
      const cfg = validateSegmentConfig('contact', {
        rules: [{ field: 'lead_status', operator: 'eq', value: 'qualified' }],
      });
      expect(cfg.match).toBe('all');
      expect(cfg.rules).toHaveLength(1);
    });

    it('honors match: any', () => {
      const cfg = validateSegmentConfig('lead', {
        match: 'any',
        rules: [{ field: 'score', operator: 'gte', value: 50 }],
      });
      expect(cfg.match).toBe('any');
    });
  });

  describe('evaluateSegment — always tenant-scoped + soft-delete excluded', () => {
    it('applies tenant_id and deleted_at even with no rules (matches all live rows)', async () => {
      const ids = await evaluateSegment({ tenantId: 'tenant-1', entityType: 'contact', config: {} });
      expect(ids).toEqual(['a', 'b']);
      expect(executeMock).toHaveBeenCalledTimes(1);
      const { text, params } = renderSql(executeMock.mock.calls[0][0]);
      expect(text).toContain('tenant_id');
      expect(text).toContain('deleted_at');
      // tenant id is a bound parameter, never concatenated.
      expect(params).toContain('tenant-1');
    });

    it('binds filter VALUES as parameters (no string concatenation)', async () => {
      await evaluateSegment({
        tenantId: 't1',
        entityType: 'contact',
        config: { rules: [{ field: 'email', operator: 'contains', value: "x' OR '1'='1" }] },
      });
      const { params } = renderSql(executeMock.mock.calls[0][0]);
      // The malicious value is present ONLY as a bound param (wrapped for ILIKE),
      // proving it is parameterized, not interpolated into SQL text.
      expect(params.some((p) => String(p).includes("x' OR '1'='1"))).toBe(true);
    });

    it('rejects unknown entity type', async () => {
      await expect(
        evaluateSegment({ tenantId: 't1', entityType: 'users' as never, config: {} }),
      ).rejects.toThrow(SegmentFilterError);
    });

    it('propagates a filter error for a bad rule', async () => {
      await expect(
        evaluateSegment({
          tenantId: 't1',
          entityType: 'contact',
          config: { rules: [{ field: 'nope', operator: 'eq', value: 1 }] },
        }),
      ).rejects.toThrow(SegmentFilterError);
    });

    it('supports presence operators without a value', async () => {
      const ids = await evaluateSegment({
        tenantId: 't1',
        entityType: 'contact',
        config: { rules: [{ field: 'email', operator: 'is_set' }] },
      });
      expect(ids).toEqual(['a', 'b']);
      const { text } = renderSql(executeMock.mock.calls[0][0]);
      expect(text).toContain('IS NOT NULL');
    });

    it('supports tag membership via has_tag', async () => {
      await evaluateSegment({
        tenantId: 't1',
        entityType: 'contact',
        config: { rules: [{ field: 'tags', operator: 'has_tag', value: 'vip' }] },
      });
      const { text, params } = renderSql(executeMock.mock.calls[0][0]);
      expect(text).toContain('ARRAY');
      expect(params).toContain('vip');
    });
  });
});
