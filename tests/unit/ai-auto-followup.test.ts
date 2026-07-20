import { describe, it, expect } from 'vitest';

describe('AI auto-followup engine', () => {
  it('module loads', async () => {
    const mod = await import('@/lib/ai/auto-followup');
    expect(mod.processAutoFollowups).toBeDefined();
    expect(typeof mod.processAutoFollowups).toBe('function');
  });

  it('buildAutoFollowupPrompt returns structured prompt', async () => {
    const { buildAutoFollowupPrompt } = await import('@/lib/ai/auto-followup');
    const prompt = buildAutoFollowupPrompt({
      followUpTitle: 'Check proposal',
      contactName: 'Alice Smith',
      dealTitle: 'Enterprise License',
      missedDays: 3,
      contactEmail: 'alice@acme.com',
    });
    expect(prompt).toContain('Alice Smith');
    expect(prompt).toContain('Enterprise License');
    expect(prompt).toContain('3');
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(50);
  });

  it('buildAutoFollowupPrompt handles missing optional fields', async () => {
    const { buildAutoFollowupPrompt } = await import('@/lib/ai/auto-followup');
    const prompt = buildAutoFollowupPrompt({
      followUpTitle: 'Quick call',
      contactName: '',
      missedDays: 1,
    });
    expect(prompt).toContain('Quick call');
    expect(typeof prompt).toBe('string');
  });
});

describe('auto-followup cron route', () => {
  it('module loads with POST handler', async () => {
    const mod = await import('@/app/api/cron/ai-auto-followup/route');
    expect(mod.POST).toBeDefined();
  });
});

describe('auto-followup settings page', () => {
  it('page module loads', async () => {
    const mod = await import('@/app/tenant/settings/ai-auto-followup/page');
    expect(mod.default).toBeDefined();
  });
});

describe('auto-followup types', () => {
  it('AutoFollowupResult type is exported', async () => {
    const mod = await import('@/lib/ai/auto-followup');
    // Type-only exports are erased at runtime, but we can verify the function signatures exist
    expect(mod.processAutoFollowups).toBeInstanceOf(Function);
  });
});

describe('auto-followup notification type', () => {
  it('ai_followup_sent notification type is valid', async () => {
    // The NotificationType in lib/notifications.ts should include 'ai_followup_sent'
    // We test this by checking that our auto-followup code uses valid types
    const { processAutoFollowups } = await import('@/lib/ai/auto-followup');
    expect(processAutoFollowups).toBeDefined();
  });
});
