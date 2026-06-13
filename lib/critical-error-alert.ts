const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitMap = new Map<string, number>();

function isRateLimited(errorMessage: string): boolean {
  const key = errorMessage.slice(0, 100);
  const now = Date.now();
  const lastSent = rateLimitMap.get(key);
  if (lastSent && now - lastSent < RATE_LIMIT_WINDOW_MS) return true;
  rateLimitMap.set(key, now);
  return false;
}

function truncateStack(stack: string, maxLines = 10): string {
  const lines = stack.split('\n');
  if (lines.length <= maxLines) return stack;
  return lines.slice(0, maxLines).join('\n') + '\n... (truncated)';
}

export async function sendCriticalErrorAlert(opts: {
  error: unknown;
  level?: string;
  context?: string;
}): Promise<void> {
  const webhookUrl = process.env.CRITICAL_ERROR_WEBHOOK_URL;
  if (!webhookUrl) return;

  const message =
    opts.error instanceof Error ? opts.error.message : String(opts.error ?? 'Unknown error');

  if (isRateLimited(message)) return;

  const stack = opts.error instanceof Error ? opts.error.stack : undefined;
  const timestamp = new Date().toISOString();
  const environment = process.env.NODE_ENV ?? 'development';

  const payload = {
    event: 'critical_error',
    level: opts.level ?? 'fatal',
    message,
    stack_trace: stack ? truncateStack(stack) : undefined,
    timestamp,
    environment,
    context: opts.context,
    service: 'nucrm-enterprise',
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // fire-and-forget: don't block main flow
  }
}
