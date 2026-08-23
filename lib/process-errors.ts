import { logger } from '@/lib/logger';
import { sendCriticalErrorAlert } from '@/lib/critical-error-alert';

/**
 * Register process-level error handlers for uncaught exceptions and
 * unhandled promise rejections. Call once per Node.js process at startup.
 *
 * After logging and alerting, the process exits with code 1 so the
 * process manager (pm2 / Docker) can restart it cleanly.
 */
export function registerProcessErrorHandlers(context: string): void {
  process.on('uncaughtException', (err) => {
    logger.error(`[${context}] UNCAUGHT EXCEPTION — shutting down`, {
      message: err.message,
      stack: err.stack,
    });
    sendCriticalErrorAlert({ error: err, level: 'fatal', context }).catch(() => {});
    // Give logger + alert a moment to flush, then exit
    setTimeout(() => process.exit(1), 500);
  });

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error(`[${context}] UNHANDLED REJECTION`, {
      message: err.message,
      stack: err.stack,
    });
    sendCriticalErrorAlert({ error: err, level: 'error', context }).catch(() => {});
  });
}
