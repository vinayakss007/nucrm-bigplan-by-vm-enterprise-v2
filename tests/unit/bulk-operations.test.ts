/**
 * Tests for lib/api/bulk-operations.ts
 */
import { describe, it, expect } from 'vitest';
import {
  executeBulk,
  validateBulkSize,
  BulkItem,
} from '@/lib/api/bulk-operations';

function makeItems<T>(data: T[]): BulkItem<T>[] {
  return data.map((d, i) => ({ index: i, data: d }));
}

describe('validateBulkSize', () => {
  it('returns null for valid arrays', () => {
    expect(validateBulkSize([1, 2, 3])).toBeNull();
  });

  it('rejects non-arrays', async () => {
    const result = validateBulkSize('not-array' as unknown as unknown[]);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(400);
    const body = await result!.json();
    expect(body.error).toContain('array');
  });

  it('rejects empty arrays', async () => {
    const result = validateBulkSize([]);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(400);
  });

  it('rejects arrays exceeding maxItems', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const result = validateBulkSize(items, 5);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(413);
    const body = await result!.json();
    expect(body.maxItems).toBe(5);
  });

  it('allows arrays at exactly maxItems', () => {
    const items = Array.from({ length: 5 }, (_, i) => i);
    expect(validateBulkSize(items, 5)).toBeNull();
  });
});

describe('executeBulk — sequential', () => {
  it('processes all items successfully', async () => {
    const items = makeItems(['a', 'b', 'c']);
    const result = await executeBulk(items, async (item) => {
      return `processed-${item.data}`;
    });

    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.hasErrors).toBe(false);
    expect(result.results[0]).toEqual({ index: 0, status: 'success', result: 'processed-a' });
    expect(result.results[2]).toEqual({ index: 2, status: 'success', result: 'processed-c' });
  });

  it('handles partial failures', async () => {
    const items = makeItems([1, 2, 3, 4, 5]);
    const result = await executeBulk(items, async (item) => {
      if (item.data === 3) throw new Error('Validation failed for item 3');
      return item.data * 10;
    });

    expect(result.total).toBe(5);
    expect(result.succeeded).toBe(4);
    expect(result.failed).toBe(1);
    expect(result.hasErrors).toBe(true);
    expect(result.results[2]).toEqual({
      index: 2,
      status: 'error',
      error: 'Validation failed for item 3',
      code: undefined,
    });
    expect(result.results[0]).toEqual({ index: 0, status: 'success', result: 10 });
  });

  it('captures error code from thrown errors', async () => {
    const items = makeItems(['x']);
    const result = await executeBulk(items, async () => {
      const err = new Error('duplicate') as Error & { code: string };
      err.code = 'DUPLICATE_KEY';
      throw err;
    });

    expect(result.results[0]).toEqual({
      index: 0,
      status: 'error',
      error: 'duplicate',
      code: 'DUPLICATE_KEY',
    });
  });

  it('stopOnError stops after first failure', async () => {
    const items = makeItems([1, 2, 3, 4, 5]);
    const processed: number[] = [];

    const result = await executeBulk(
      items,
      async (item) => {
        processed.push(item.data);
        if (item.data === 2) throw new Error('fail');
        return item.data;
      },
      { stopOnError: true },
    );

    expect(processed).toEqual([1, 2]); // Stopped after item 2
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('handles all items failing', async () => {
    const items = makeItems([1, 2, 3]);
    const result = await executeBulk(items, async () => {
      throw new Error('all fail');
    });

    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(3);
    expect(result.hasErrors).toBe(true);
  });

  it('handles single item', async () => {
    const items = makeItems(['only']);
    const result = await executeBulk(items, async (item) => item.data);

    expect(result.total).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.results).toHaveLength(1);
  });

  it('results are sorted by original index', async () => {
    const items = makeItems([10, 20, 30]);
    const result = await executeBulk(items, async (item) => item.data);

    expect(result.results.map((r) => r.index)).toEqual([0, 1, 2]);
  });
});

describe('executeBulk — concurrent', () => {
  it('processes items in parallel', async () => {
    const items = makeItems([1, 2, 3, 4, 5]);
    const startTimes: number[] = [];

    const result = await executeBulk(
      items,
      async (item) => {
        startTimes.push(Date.now());
        await new Promise((r) => setTimeout(r, 10));
        return item.data;
      },
      { concurrency: 3 },
    );

    expect(result.succeeded).toBe(5);
    // With concurrency=3, first 3 items should start near-simultaneously
    // (within a few ms of each other)
    if (startTimes.length >= 3) {
      const spread = startTimes[2]! - startTimes[0]!;
      expect(spread).toBeLessThan(20); // Should be near-simultaneous
    }
  });

  it('handles errors in parallel mode', async () => {
    const items = makeItems([1, 2, 3]);
    const result = await executeBulk(
      items,
      async (item) => {
        if (item.data === 2) throw new Error('bad');
        return item.data;
      },
      { concurrency: 3 },
    );

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
  });

  it('results sorted by index even with parallel execution', async () => {
    const items = makeItems([1, 2, 3, 4, 5]);
    const result = await executeBulk(
      items,
      async (item) => {
        // Varying delays to randomize completion order
        await new Promise((r) => setTimeout(r, (5 - item.data) * 5));
        return item.data;
      },
      { concurrency: 5 },
    );

    expect(result.results.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
  });
});
