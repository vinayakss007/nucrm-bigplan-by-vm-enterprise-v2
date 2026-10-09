import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerProcessErrorHandlers } from '@/lib/process-errors';
import { logger } from '@/lib/logger';
import { sendCriticalErrorAlert } from '@/lib/critical-error-alert';

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock('@/lib/critical-error-alert', () => ({
  sendCriticalErrorAlert: vi.fn(() => Promise.resolve()),
}));

describe('registerProcessErrorHandlers', () => {
  let processOnSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as unknown as typeof process.exit);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should register handlers for uncaughtException and unhandledRejection', () => {
    registerProcessErrorHandlers('test-context');

    expect(processOnSpy).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
    expect(processOnSpy).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
  });

  it('should handle uncaughtException by logging, alerting, and exiting', async () => {
    let uncaughtExceptionHandler: (err: unknown) => void;
    processOnSpy.mockImplementation((event, handler) => {
      if (event === 'uncaughtException') {
        uncaughtExceptionHandler = handler;
      }
      return process;
    });

    registerProcessErrorHandlers('test-context');

    const testError = new Error('Test uncaught error');
    uncaughtExceptionHandler(testError);

    expect(logger.error).toHaveBeenCalledWith(
      '[test-context] UNCAUGHT EXCEPTION — shutting down',
      {
        message: testError.message,
        stack: testError.stack,
      }
    );

    expect(sendCriticalErrorAlert).toHaveBeenCalledWith({
      error: testError,
      level: 'fatal',
      context: 'test-context',
    });

    expect(processExitSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle unhandledRejection with an Error object', async () => {
    let unhandledRejectionHandler: (err: unknown) => void;
    processOnSpy.mockImplementation((event, handler) => {
      if (event === 'unhandledRejection') {
        unhandledRejectionHandler = handler;
      }
      return process;
    });

    registerProcessErrorHandlers('test-context');

    const testError = new Error('Test unhandled rejection');
    unhandledRejectionHandler(testError);

    expect(logger.error).toHaveBeenCalledWith(
      '[test-context] UNHANDLED REJECTION',
      {
        message: testError.message,
        stack: testError.stack,
      }
    );

    expect(sendCriticalErrorAlert).toHaveBeenCalledWith({
      error: testError,
      level: 'error',
      context: 'test-context',
    });
  });

  it('should handle unhandledRejection with a non-Error reason', async () => {
    let unhandledRejectionHandler: (err: unknown) => void;
    processOnSpy.mockImplementation((event, handler) => {
      if (event === 'unhandledRejection') {
        unhandledRejectionHandler = handler;
      }
      return process;
    });

    registerProcessErrorHandlers('test-context');

    unhandledRejectionHandler('String reason');

    expect(logger.error).toHaveBeenCalledWith(
      '[test-context] UNHANDLED REJECTION',
      expect.objectContaining({
        message: 'String reason',
      })
    );

    expect(sendCriticalErrorAlert).toHaveBeenCalledWith({
      error: expect.any(Error),
      level: 'error',
      context: 'test-context',
    });
  });
});
