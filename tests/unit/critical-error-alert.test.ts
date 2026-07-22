import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/pagerduty', () => ({ sendPagerDutyAlert: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/email/service', () => ({ sendWebhookNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/telegram-admin', () => ({ sendAdminTelegram: vi.fn().mockResolvedValue(undefined) }));

describe('critical-error-alert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends to all channels', async () => {
    const { sendCriticalErrorAlert } = await import('@/lib/critical-error-alert');
    const { sendPagerDutyAlert } = await import('@/lib/pagerduty');
    const { sendWebhookNotification } = await import('@/lib/email/service');
    const { sendAdminTelegram } = await import('@/lib/telegram-admin');
    await sendCriticalErrorAlert({ error: new Error('Something broke'), level: 'fatal', context: 'test' });
    expect(sendPagerDutyAlert).toHaveBeenCalled();
    expect(sendWebhookNotification).toHaveBeenCalled();
    expect(sendAdminTelegram).toHaveBeenCalled();
  });

  it('rate limits duplicate errors within same minute', async () => {
    const { sendCriticalErrorAlert } = await import('@/lib/critical-error-alert');
    const { sendPagerDutyAlert } = await import('@/lib/pagerduty');
    await sendCriticalErrorAlert({ error: new Error('Rate limit test') });
    await sendCriticalErrorAlert({ error: new Error('Rate limit test') });
    expect(sendPagerDutyAlert).toHaveBeenCalledTimes(1);
  });

  it('handles non-Error objects', async () => {
    const { sendCriticalErrorAlert } = await import('@/lib/critical-error-alert');
    const { sendPagerDutyAlert } = await import('@/lib/pagerduty');
    await sendCriticalErrorAlert({ error: 'string error' });
    expect(sendPagerDutyAlert).toHaveBeenCalled();
  });

  it('handles null error gracefully', async () => {
    const { sendCriticalErrorAlert } = await import('@/lib/critical-error-alert');
    const { sendPagerDutyAlert } = await import('@/lib/pagerduty');
    await sendCriticalErrorAlert({ error: null });
    expect(sendPagerDutyAlert).toHaveBeenCalled();
  });

  it('includes error stack and context', async () => {
    const { sendCriticalErrorAlert } = await import('@/lib/critical-error-alert');
    const { sendPagerDutyAlert } = await import('@/lib/pagerduty');
    const error = new Error('Context test');
    await sendCriticalErrorAlert({ error, context: 'checkout' });
    const callArg = (sendPagerDutyAlert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.details.stack_trace).toBeDefined();
    expect(callArg.details.context).toBe('checkout');
  });

  it('truncates long stacks', async () => {
    const { sendCriticalErrorAlert } = await import('@/lib/critical-error-alert');
    const { sendPagerDutyAlert } = await import('@/lib/pagerduty');
    const longStack = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const error = new Error('Long stack');
    error.stack = longStack;
    await sendCriticalErrorAlert({ error });
    const callArg = (sendPagerDutyAlert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const stackLines = callArg.details.stack_trace.split('\n');
    expect(stackLines.length).toBeLessThanOrEqual(12);
  });
});
