import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbExecute = vi.fn();
const mockDbInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
const mockDbSelect = vi.fn();
const mockDbDelete = vi.fn();

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: (...args: any[]) => mockDbExecute(...args),
    insert: (...args: any[]) => mockDbInsert(...args),
    select: (...args: any[]) => ({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }),
    delete: (...args: any[]) => mockDbDelete(...args),
  },
}));

describe('CriticalDataCapture', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('initializes with default retention', async () => {
    const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
    const cdc = new CriticalDataCapture();
    expect(cdc).toBeDefined();
  });

  it('captureBeforeDelete returns 0 for non-critical table', async () => {
    const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
    const cdc = new CriticalDataCapture();
    const count = await cdc.captureBeforeDelete('t1', 'non_critical_table', ['id1']);
    expect(count).toBe(0);
  });

  it('captureBeforeDelete captures data for critical table', async () => {
    mockDbExecute.mockResolvedValue({ rows: [{ id: 'id1', name: 'test', value: 100 }] });
    const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
    const cdc = new CriticalDataCapture();
    const count = await cdc.captureBeforeDelete('t1', 'contacts', ['id1']);
    expect(count).toBe(1);
  });

  it('captureBeforeDelete skips missing records', async () => {
    mockDbExecute.mockResolvedValue({ rows: [] });
    const { CriticalDataCapture } = await import('@/lib/critical-data-capture');
    const cdc = new CriticalDataCapture();
    const count = await cdc.captureBeforeDelete('t1', 'contacts', ['missing_id']);
    expect(count).toBe(0);
  });
});
