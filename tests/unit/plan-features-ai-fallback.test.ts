import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('AI plan feature fallback is consistent on client and server', () => {
  it('maps fine-grained AI keys to ai_assistant in both gate implementations', () => {
    const server = read('lib/ai/plan-gate.ts');
    const client = read('hooks/use-plan-features.ts');
    expect(server).toContain("featureKey.startsWith('ai_')");
    expect(server).toContain("const COARSE_AI_FEATURE = 'ai_assistant'");
    expect(server).toContain('features.includes(COARSE_AI_FEATURE)');
    expect(client).toContain("featureKey.startsWith('ai_')");
    expect(client).toContain("featureSet.has('ai_assistant')");
  });

  it('uses the same helper for requireAiFeature and planHasFeature', () => {
    const server = read('lib/ai/plan-gate.ts');
    expect((server.match(/grantsFeature\(features, featureKey\)/g) ?? []).length).toBe(2);
  });
});
