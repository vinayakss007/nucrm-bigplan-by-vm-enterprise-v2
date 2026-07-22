import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/email/service', () => ({
  alertSuperAdmin: vi.fn(),
}));

describe('Email Alerts', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('calls alertSuperAdmin with subject and message', async () => {
    const { alertSuperAdmin } = await import('@/lib/email/service');
    (alertSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const { sendAlertEmail } = await import('@/lib/email/alerts');
    await sendAlertEmail('Test Subject', 'Test Message');

    expect(alertSuperAdmin).toHaveBeenCalledWith('Test Subject', 'Test Message');
  });
});
