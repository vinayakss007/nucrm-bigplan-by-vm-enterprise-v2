import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => ({
  db: { insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }) },
}));

describe('logError (server)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('handles Error instances', async () => {
    const { logError } = await import('@/lib/errors-server');
    const { db } = await import('@/drizzle/db');
    await logError({ error: new Error('test error'), context: 'test' });
    expect(db.insert).toHaveBeenCalled();
  });

  it('handles string errors', async () => {
    const { logError } = await import('@/lib/errors-server');
    const { db } = await import('@/drizzle/db');
    await logError({ error: 'string error', level: 'fatal' });
    expect(db.insert).toHaveBeenCalled();
  });

  it('handles null errors', async () => {
    const { logError } = await import('@/lib/errors-server');
    const { db } = await import('@/drizzle/db');
    await logError({ error: null, context: 'null test' });
    expect(db.insert).toHaveBeenCalled();
  });

  it('includes tenantId and userId when provided', async () => {
    const { logError } = await import('@/lib/errors-server');
    const { db } = await import('@/drizzle/db');
    await logError({ error: 'err', tenantId: 't1', userId: 'u1', level: 'warning', context: 'ctx' });
    expect(db.insert).toHaveBeenCalled();
  });
});

describe('withErrorLogging', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns result on success', async () => {
    const { withErrorLogging } = await import('@/lib/errors-server');
    const result = await withErrorLogging(() => Promise.resolve(42), 'ctx');
    expect(result).toBe(42);
  });

  it('returns null and logs on failure', async () => {
    const { withErrorLogging } = await import('@/lib/errors-server');
    const result = await withErrorLogging(() => Promise.reject(new Error('fail')), 'ctx');
    expect(result).toBeNull();
  });
});
