import { describe, it, expect, vi } from 'vitest';

vi.mock('@/drizzle/db', () => ({ db: {} }));
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('server-only', () => ({}));

import { computeFieldAnalytics } from '@/app/api/tenant/forms/[id]/analytics/route';

describe('computeFieldAnalytics', () => {
  const fields = [
    { key: 'full_name', label: 'Full Name', type: 'text', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'product', label: 'Product Interest', type: 'select', options: ['Option A', 'Option B', 'Option C'] },
    { key: 'rating', label: 'Rating', type: 'number' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ];

  const submissions = [
    { full_name: 'Alice', email: 'alice@x.com', product: 'Option A', rating: 5, notes: 'Great' },
    { full_name: 'Bob', email: 'bob@x.com', product: 'Option B', rating: 3, notes: '' },
    { full_name: 'Charlie', email: 'charlie@x.com', product: 'Option A', rating: 4 },
    { full_name: 'Diana', email: 'diana@x.com', product: 'Option C', rating: 5 },
    { full_name: 'Eve', email: '', product: 'Option B', rating: 2 },
  ];

  it('returns one entry per field', () => {
    const result = computeFieldAnalytics(fields, submissions);
    expect(result).toHaveLength(5);
    expect(result.map((f) => f.key)).toEqual(['full_name', 'email', 'product', 'rating', 'notes']);
  });

  it('computes completion rate as 100% for always-filled fields', () => {
    const result = computeFieldAnalytics(fields, submissions);
    const fullName = result.find((f) => f.key === 'full_name')!;
    expect(fullName.filled).toBe(5);
    expect(fullName.total).toBe(5);
    expect(fullName.completionRate).toBe(100);
  });

  it('computes lower completion rate for fields with empty submissions', () => {
    const result = computeFieldAnalytics(fields, submissions);
    const email = result.find((f) => f.key === 'email')!;
    expect(email.filled).toBe(4);
    expect(email.completionRate).toBe(80);

    const notes = result.find((f) => f.key === 'notes')!;
    expect(notes.filled).toBe(1);
    expect(notes.completionRate).toBe(20);
  });

  it('returns value distribution for select fields', () => {
    const result = computeFieldAnalytics(fields, submissions);
    const product = result.find((f) => f.key === 'product')!;
    expect(product.valueDistribution).toBeDefined();
    expect(product.valueDistribution).toEqual(
      expect.arrayContaining([
        { value: 'Option A', count: 2 },
        { value: 'Option B', count: 2 },
        { value: 'Option C', count: 1 },
      ]),
    );
  });

  it('returns value distribution with zero counts for unselected options', () => {
    const product = computeFieldAnalytics(fields, submissions).find((f) => f.key === 'product')!;
    const optA = product.valueDistribution!.find((v) => v.value === 'Option A')!;
    const optC = product.valueDistribution!.find((v) => v.value === 'Option C')!;
    expect(optA.count).toBe(2);
    expect(optC.count).toBe(1);
  });

  it('returns numeric stats for number fields', () => {
    const result = computeFieldAnalytics(fields, submissions);
    const rating = result.find((f) => f.key === 'rating')!;
    expect(rating.numericStats).toBeDefined();
    expect(rating.numericStats!.min).toBe(2);
    expect(rating.numericStats!.max).toBe(5);
    expect(rating.numericStats!.avg).toBeCloseTo(3.8, 1);
  });

  it('returns zero completion rate when no submissions', () => {
    const result = computeFieldAnalytics(fields, []);
    expect(result).toHaveLength(5);
    result.forEach((f) => {
      expect(f.filled).toBe(0);
      expect(f.completionRate).toBe(0);
    });
  });

  it('returns empty array when no fields defined', () => {
    const result = computeFieldAnalytics([], submissions);
    expect(result).toEqual([]);
  });

  it('handles checkbox fields with multiple values', () => {
    const checkboxFields = [
      { key: 'interests', label: 'Interests', type: 'multiselect', options: ['Tech', 'Sports', 'Art'] },
    ];
    const checkboxSubmissions = [
      { interests: ['Tech', 'Sports'] },
      { interests: ['Tech'] },
      { interests: ['Art', 'Sports'] },
      { interests: [] },
    ];
    const result = computeFieldAnalytics(checkboxFields, checkboxSubmissions);
    expect(result[0].filled).toBe(3);
    expect(result[0].completionRate).toBe(75);
    expect(result[0].valueDistribution).toEqual(
      expect.arrayContaining([
        { value: 'Tech', count: 2 },
        { value: 'Sports', count: 2 },
        { value: 'Art', count: 1 },
      ]),
    );
  });

  it('returns undefined numericStats when no numeric values', () => {
    const numFields = [{ key: 'score', label: 'Score', type: 'number' }];
    const result = computeFieldAnalytics(numFields, [{ score: 'abc' }, { score: null }]);
    expect(result[0].numericStats).toBeUndefined();
  });

  // #2287: API-created forms persist fields with `id` (no `key`). Analytics
  // must resolve the same identity as the submit validator, otherwise every
  // field reports 0% completion.
  describe('id-shaped (API-created) fields (#2287)', () => {
    const apiFields = [
      { id: 'full_name', label: 'Full Name', type: 'text', required: true },
      { id: 'product', label: 'Product Interest', type: 'select', options: ['A', 'B'] },
    ];
    const data = [
      { full_name: 'Alice', product: 'A' },
      { full_name: 'Bob', product: 'B' },
      { full_name: '', product: 'A' },
    ];

    it('matches submissions by field id for filled counts', () => {
      const result = computeFieldAnalytics(apiFields as never, data);
      expect(result.map((f) => f.key)).toEqual(['full_name', 'product']);
      expect(result[0].filled).toBe(2);
      expect(result[0].completionRate).toBe(67);
      expect(result[1].valueDistribution).toEqual(
        expect.arrayContaining([{ value: 'A', count: 2 }, { value: 'B', count: 1 }]),
      );
    });

    it('key still wins when both id and key are present', () => {
      const both = [{ id: '1', key: 'email', label: 'Email', type: 'email' }];
      const result = computeFieldAnalytics(both as never, [{ email: 'a@b.co' }]);
      expect(result[0].key).toBe('email');
      expect(result[0].filled).toBe(1);
    });

    it('reports zero-filled analytics for fields without any identity', () => {
      const result = computeFieldAnalytics([{ label: 'Ghost', type: 'text' } as never], [{ x: 1 }]);
      expect(result[0].key).toBe('');
      expect(result[0].filled).toBe(0);
    });
  });
});
