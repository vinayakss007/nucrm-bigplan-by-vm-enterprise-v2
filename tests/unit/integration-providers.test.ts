import { describe, it, expect } from 'vitest';

describe('Integration Providers', () => {
  it('mailgunProvider has correct structure', async () => {
    const { mailgunProvider } = await import('@/lib/integrations/providers/mailgun');
    expect(mailgunProvider.id).toBe('mailgun');
    expect(mailgunProvider.category).toBe('email');
    expect(mailgunProvider.capabilities).toHaveLength(1);
    expect(mailgunProvider.configFields).toHaveLength(5);
    expect(mailgunProvider.builtIn).toBe(true);
  });

  it('sendgridProvider has correct structure', async () => {
    const { sendgridProvider } = await import('@/lib/integrations/providers/sendgrid');
    expect(sendgridProvider.id).toBe('sendgrid');
    expect(sendgridProvider.category).toBe('email');
    expect(sendgridProvider.capabilities).toHaveLength(2);
    expect(sendgridProvider.configFields).toHaveLength(3);
    expect(sendgridProvider.builtIn).toBe(true);
  });

  it('slackProvider has correct structure', async () => {
    const { slackProvider } = await import('@/lib/integrations/providers/slack');
    expect(slackProvider.id).toBe('slack');
    expect(slackProvider.category).toBe('messaging');
    expect(slackProvider.capabilities).toHaveLength(1);
    expect(slackProvider.configFields).toHaveLength(2);
    expect(slackProvider.builtIn).toBe(true);
  });

  it('openaiProvider has correct structure', async () => {
    const { openaiProvider } = await import('@/lib/integrations/providers/openai');
    expect(openaiProvider.id).toBe('openai');
    expect(openaiProvider.category).toBe('ai');
    expect(openaiProvider.capabilities).toHaveLength(3);
    expect(openaiProvider.configFields).toHaveLength(2);
    expect(openaiProvider.builtIn).toBe(true);
  });
});
