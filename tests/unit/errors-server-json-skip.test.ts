import { describe, it, expect, vi } from 'vitest';

// Wave 10: logError() must short-circuit InvalidJsonBodyError — no error_logs
// row, no Sentry capture, no critical alert — because every renderer already
// answers it as a 400 client error.

const mockInsert = vi.fn();
vi.mock('@/drizzle/db', () => ({
  db: { insert: () => ({ values: (...args: unknown[]) => mockInsert(...args) }) },
}));
vi.mock('@/lib/critical-error-alert', () => ({ sendCriticalErrorAlert: vi.fn() }));

describe('errors-server logError skip', () => {
  it('does not write or console-error an InvalidJsonBodyError', async () => {
    const { logError } = await import('@/lib/errors-server');
    const { InvalidJsonBodyError } = await import('@/lib/errors-shared');
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    await logError({ error: new InvalidJsonBodyError(new SyntaxError('bad')), context: 'test' });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(consoleErr).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('still processes a real server error', async () => {
    const { logError } = await import('@/lib/errors-server');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    await logError({ error: new Error('real failure'), context: 'test' });
    // Test mode diverts the DB row to a console.log marker; the point is it
    // proceeded past the short-circuit.
    const processed = consoleLog.mock.calls.length > 0 || consoleErr.mock.calls.length > 0;
    expect(processed).toBe(true);
    consoleLog.mockRestore();
    consoleErr.mockRestore();
  });
});
