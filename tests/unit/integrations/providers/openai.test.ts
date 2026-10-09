import { describe, it, expect } from 'vitest';
import { openaiProvider } from '@/lib/integrations/providers/openai';

describe('openaiProvider', () => {
  it('has the correct base configuration', () => {
    expect(openaiProvider.id).toBe('openai');
    expect(openaiProvider.name).toBe('OpenAI');
    expect(openaiProvider.category).toBe('ai');
    expect(openaiProvider.builtIn).toBe(true);
    expect(openaiProvider.defaultBaseUrl).toBe('https://api.openai.com/v1');
  });

  it('has the expected config fields', () => {
    const api_key = openaiProvider.configFields.find(f => f.key === 'api_key');
    expect(api_key).toBeDefined();
    expect(api_key?.required).toBe(true);

    const model = openaiProvider.configFields.find(f => f.key === 'model');
    expect(model).toBeDefined();
    expect(model?.required).toBe(true);
    expect(model?.options).toBeDefined();
    expect(model?.options?.length).toBeGreaterThan(0);
  });

  it('has the expected capabilities', () => {
    const generate = openaiProvider.capabilities.find(c => c.action === 'generate');
    expect(generate).toBeDefined();
    expect(generate?.inputFields.find(f => f.key === 'prompt')?.required).toBe(true);

    const summarize = openaiProvider.capabilities.find(c => c.action === 'summarize');
    expect(summarize).toBeDefined();
    expect(summarize?.inputFields.find(f => f.key === 'text')?.required).toBe(true);

    const draft_email = openaiProvider.capabilities.find(c => c.action === 'draft_email');
    expect(draft_email).toBeDefined();
    expect(draft_email?.inputFields.find(f => f.key === 'context')?.required).toBe(true);
  });
});
