import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('logger', () => {
  beforeEach(() => {
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

  it('logger.warn logs structured JSON', async () => {
    const { logger } = await import('@/lib/logger');
    
    logger.warn('Warning message', { detail: 'something' });
    
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('"level":"warn"')
    );
  });

  it('logger.error logs structured JSON', async () => {
    const { logger } = await import('@/lib/logger');
    
    logger.error('Error occurred', { error: 'details' });
    
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('"level":"error"')
    );
  });

  it('safeError returns sanitized error', async () => {
    const { safeError } = await import('@/lib/logger');
    
    const result = safeError(new Error('Internal DB error'), 'test-context');
    
    expect(result.message).toBe('An internal error occurred');
    expect(result.code).toBe('INTERNAL_ERROR');
  });

  it('safeError handles non-Error objects', async () => {
    const { safeError } = await import('@/lib/logger');
    
    const result = safeError('string error', 'context');
    
    expect(result.message).toBe('An unexpected error occurred');
    expect(result.code).toBe('UNKNOWN_ERROR');
  });

  it('safeError handles null', async () => {
    const { safeError } = await import('@/lib/logger');
    
    const result = safeError(null, 'context');
    
    expect(result.code).toBe('UNKNOWN_ERROR');
  });
});
