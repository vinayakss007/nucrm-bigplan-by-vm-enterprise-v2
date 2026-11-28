import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_CAPABILITIES } from '@/components/tenant/ai/ai-config';
import { SEED_DRAFT_TEMPLATES } from '@/lib/ai/draft';

const ROOT = join(import.meta.dirname!, '../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('newly exposed AI capabilities', () => {
  it('registers insights and email drafts in the AI hub navigation', () => {
    const paths = AI_CAPABILITIES.map(c => c.href);
    expect(paths).toContain('/tenant/ai/insights');
    expect(paths).toContain('/tenant/ai/email-drafts');
    for (const href of ['/tenant/ai/insights', '/tenant/ai/email-drafts']) {
      const capability = AI_CAPABILITIES.find(c => c.href === href);
      expect(capability?.featureKey).toBe('ai_assistant');
      expect(capability?.icon).toBeTruthy();
    }
  });

  it('adds both capabilities to the hub quick actions', () => {
    const hub = read('app/tenant/ai/page.tsx');
    expect(hub).toContain('href="/tenant/ai/insights"');
    expect(hub).toContain('href="/tenant/ai/email-drafts"');
  });

  it('uses the plan feature that actually exists on paid plans', () => {
    const insights = read('app/api/tenant/ai/insights/route.ts');
    const drafts = read('app/api/tenant/ai/email-draft/route.ts');
    for (const source of [insights, drafts]) {
      expect(source).toContain("requireAiFeature(ctx, 'ai_assistant')");
      expect(source).not.toMatch(/requireAiFeature\(ctx, '(ai_insights|ai_draft)'\)/);
    }
  });

  it('ships pages that call the existing AI endpoints', () => {
    const insights = read('app/tenant/ai/insights/page.tsx');
    const drafts = read('app/tenant/ai/email-drafts/page.tsx');
    expect(insights).toContain("'/api/tenant/ai/insights'");
    expect(insights).toContain('method: \'POST\'');
    expect(drafts).toContain("'/api/tenant/ai/email-draft'");
    expect(drafts).toContain('purpose');
  });

  it('adds seed draft templates without colliding slugs', () => {
    const slugs = SEED_DRAFT_TEMPLATES.map(t => t.slug);
    expect(slugs).toContain('re-engage-quiet-contact');
    expect(slugs).toContain('deal-risk-check-in');
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const template of SEED_DRAFT_TEMPLATES) {
      expect(template.systemPrompt.length).toBeGreaterThan(20);
      expect(template.userPrompt).toContain('{{');
    }
  });
});
