import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/email/service', () => ({ sendTelegram: vi.fn() }));

describe('telegram-admin', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.env['TELEGRAM_BOT_TOKEN'] = 'bot:token';
    process.env['TELEGRAM_CHAT_ID'] = 'chat-1';
  });

  afterAll(() => {
    delete process.env['TELEGRAM_BOT_TOKEN'];
    delete process.env['TELEGRAM_CHAT_ID'];
  });

  it('sends telegram message with configured bot and chat', async () => {
    const { sendTelegram } = await import('@/lib/email/service');
    (sendTelegram as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { sendAdminTelegram } = await import('@/lib/telegram-admin');
    await sendAdminTelegram({ title: 'Test Alert', message: 'Something happened' });
    expect(sendTelegram).toHaveBeenCalledWith({
      botToken: 'bot:token',
      chatId: 'chat-1',
      title: 'Test Alert',
      message: 'Something happened',
      icon: undefined,
      url: undefined,
    });
  });

  it('skips sending when chat ID missing', async () => {
    delete process.env['TELEGRAM_CHAT_ID'];
    const { sendTelegram } = await import('@/lib/email/service');
    const { sendAdminTelegram } = await import('@/lib/telegram-admin');
    await sendAdminTelegram({ title: 'Test', message: 'Skip' });
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it('skips sending when bot token missing', async () => {
    delete process.env['TELEGRAM_BOT_TOKEN'];
    const { sendTelegram } = await import('@/lib/email/service');
    const { sendAdminTelegram } = await import('@/lib/telegram-admin');
    await sendAdminTelegram({ title: 'Test', message: 'Skip' });
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it('handles sendTelegram errors gracefully', async () => {
    const { sendTelegram } = await import('@/lib/email/service');
    (sendTelegram as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
    const { sendAdminTelegram } = await import('@/lib/telegram-admin');
    await expect(sendAdminTelegram({ title: 'Test', message: 'Err' })).resolves.toBeUndefined();
  });

  it('sends with optional icon and url', async () => {
    const { sendTelegram } = await import('@/lib/email/service');
    (sendTelegram as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { sendAdminTelegram } = await import('@/lib/telegram-admin');
    await sendAdminTelegram({ title: 'Alert', message: 'Check', icon: '🚨', url: 'https://example.com' });
    expect(sendTelegram).toHaveBeenCalledWith(expect.objectContaining({ icon: '🚨', url: 'https://example.com' }));
  });
});
