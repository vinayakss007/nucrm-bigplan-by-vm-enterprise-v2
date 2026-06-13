import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tenant/request-context', () => ({
  getCurrentRequestId: vi.fn(),
}));

const mockAppendFileSync = vi.fn();
const mockExistsSync = vi.fn().mockReturnValue(false);
const mockStatSync = vi.fn().mockReturnValue({ size: 0 });
const mockUnlinkSync = vi.fn();
const mockRenameSync = vi.fn();
vi.mock('fs', () => ({
  default: { appendFileSync: mockAppendFileSync, existsSync: mockExistsSync, statSync: mockStatSync, unlinkSync: mockUnlinkSync, renameSync: mockRenameSync },
  appendFileSync: mockAppendFileSync,
  existsSync: mockExistsSync,
  statSync: mockStatSync,
  unlinkSync: mockUnlinkSync,
  renameSync: mockRenameSync,
}));

describe('logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('logger.info logs structured JSON', async () => {
    const { logger } = await import('@/lib/logger');

    logger.info('Test message', { userId: '123' });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"level":"info"')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"msg":"Test message"')
    );
  });

  it('logger.info includes timestamp', async () => {
    const { logger } = await import('@/lib/logger');
    logger.info('msg');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"ts":')
    );
  });

  it('logger.warn logs structured JSON', async () => {
    const { logger } = await import('@/lib/logger');

    logger.warn('Warning message', { detail: 'something' });

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('"level":"warn"')
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('"msg":"Warning message"')
    );
  });

  it('logger.error logs structured JSON', async () => {
    const { logger } = await import('@/lib/logger');

    logger.error('Error occurred', { error: 'details' });

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('"level":"error"')
    );
  });

  it('logger.info works without meta', async () => {
    const { logger } = await import('@/lib/logger');
    logger.info('Just a message');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"msg":"Just a message"')
    );
  });

  it('includes requestId when available', async () => {
    const { getCurrentRequestId } = await import('@/lib/tenant/request-context');
    (getCurrentRequestId as ReturnType<typeof vi.fn>).mockReturnValue('req-123');

    const { logger } = await import('@/lib/logger');
    logger.info('test');

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"requestId":"req-123"')
    );
  });

  it('does not include requestId when not available', async () => {
    const { getCurrentRequestId } = await import('@/lib/tenant/request-context');
    (getCurrentRequestId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const { logger } = await import('@/lib/logger');
    logger.info('test');

    const callArg = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(JSON.parse(callArg)).not.toHaveProperty('requestId');
  });

  it('writes to log file', async () => {
    const { logger } = await import('@/lib/logger');
    logger.info('file test', { key: 'val' });
    expect(mockAppendFileSync).toHaveBeenCalledWith(
      expect.stringContaining('nucrm.log'),
      expect.stringContaining('"level":"info"')
    );
  });
});

describe('safeError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns sanitized error for Error objects', async () => {
    const { safeError } = await import('@/lib/logger');

    const result = safeError(new Error('Internal DB error'), 'test-context');

    expect(result.message).toBe('An internal error occurred');
    expect(result.code).toBe('INTERNAL_ERROR');
  });

  it('handles non-Error objects', async () => {
    const { safeError } = await import('@/lib/logger');

    const result = safeError('string error', 'context');

    expect(result.message).toBe('An unexpected error occurred');
    expect(result.code).toBe('UNKNOWN_ERROR');
  });

  it('handles null', async () => {
    const { safeError } = await import('@/lib/logger');

    const result = safeError(null, 'context');

    expect(result.code).toBe('UNKNOWN_ERROR');
  });

  it('handles undefined', async () => {
    const { safeError } = await import('@/lib/logger');
    const result = safeError(undefined, 'ctx');
    expect(result.code).toBe('UNKNOWN_ERROR');
  });

  it('logs full error details server-side', async () => {
    const { safeError, logger } = await import('@/lib/logger');
    vi.spyOn(logger, 'error').mockImplementation(() => {});

    safeError(new Error('hidden message'), 'my-context');

    expect(logger.error).toHaveBeenCalledWith(
      '[my-context] Error',
      expect.objectContaining({ message: 'hidden message' })
    );
  });
});
