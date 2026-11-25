import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('auto-followup works with AI disabled (#3863)', () => {
  it('builds a useful deterministic draft with no AI call', async () => {
    const { buildDeterministicDraft } = await import('@/lib/ai/auto-followup');
    const draft = buildDeterministicDraft({
      followUpTitle: 'Check in on renewal',
      contactName: 'Ada',
      dealTitle: 'Enterprise plan',
      missedDays: 3,
      companyName: 'Acme',
    });
    expect(draft).toContain('Hi Ada,');
    expect(draft).toContain('Check in on renewal (Enterprise plan)');
    expect(draft).toContain('3 days overdue');
    expect(draft).toContain('at Acme');
  });

  it('handles missing optional fields', async () => {
    const { buildDeterministicDraft } = await import('@/lib/ai/auto-followup');
    const draft = buildDeterministicDraft({ followUpTitle: 'Say hello', contactName: '', missedDays: 1 });
    expect(draft).toContain('Hi there,');
    expect(draft).toContain('1 day overdue');
    expect(draft).not.toContain('undefined');
  });

  it('falls back to the deterministic draft when chat rejects', () => {
    const src = readFileSync(join(process.cwd(), 'lib/ai/auto-followup.ts'), 'utf8');
    expect(src).toContain('let deterministic = false;');
    expect(src).toContain('draftText = buildDeterministicDraft({');
    expect(src).toContain('results.push({ followUpId: fu.id, drafted: true, ...(deterministic ? { deterministic: true } : {}) });');
    expect(src).not.toContain('body: aiResult.text.slice(0, 500)');
  });
});
