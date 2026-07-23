import { describe, it, expect } from 'vitest';

const providers = [
  { name: 'slack',      path: '@/lib/integrations/providers/slack',      exportName: 'slackProvider',      expectedId: 'slack' },
  { name: 'mailgun',    path: '@/lib/integrations/providers/mailgun',    exportName: 'mailgunProvider',    expectedId: 'mailgun' },
  { name: 'sendgrid',   path: '@/lib/integrations/providers/sendgrid',   exportName: 'sendgridProvider',   expectedId: 'sendgrid' },
  { name: 'openai',     path: '@/lib/integrations/providers/openai',     exportName: 'openaiProvider',     expectedId: 'openai' },
] as const;

describe.each(providers)('$name provider definition', ({ path, exportName, expectedId }) => {
  it('exports a valid ProviderDefinition', async () => {
    const mod = await import(path);
    const provider = mod[exportName];
    expect(provider).toBeDefined();
    expect(provider.id).toBe(expectedId);
    expect(provider.name).toBeTruthy();
    expect(provider.description).toBeTruthy();
    expect(provider.category).toBeTruthy();
    expect(Array.isArray(provider.configFields)).toBe(true);
    expect(Array.isArray(provider.capabilities)).toBe(true);
  });

  it('has valid configFields', async () => {
    const mod = await import(path);
    const provider = mod[exportName];
    for (const field of provider.configFields) {
      expect(field.key).toBeTruthy();
      expect(field.label).toBeTruthy();
      expect(['string', 'boolean', 'select']).toContain(field.type);
    }
  });

  it('has valid capabilities with inputFields', async () => {
    const mod = await import(path);
    const provider = mod[exportName];
    for (const cap of provider.capabilities) {
      expect(cap.action).toBeTruthy();
      expect(cap.label).toBeTruthy();
      expect(Array.isArray(cap.inputFields)).toBe(true);
    }
  });
});
