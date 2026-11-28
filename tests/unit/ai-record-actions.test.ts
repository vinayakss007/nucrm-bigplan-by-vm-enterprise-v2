import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('record-page AI actions (no migration)', () => {
  it('wires the AI action strip into deal and contact detail pages', () => {
    const deal = read('app/tenant/deals/[id]/page.tsx');
    const contact = read('app/tenant/contacts/[id]/page.tsx');
    for (const [source, entityType] of [[deal, 'deal'], [contact, 'contact']] as const) {
      expect(source).toContain("from '@/components/tenant/ai/record-ai-actions'");
      expect(source).toContain(`entityType="${entityType}"`);
      expect(source).toContain('canEdit={permissions.canEdit}');
      expect(source).toContain('</>');
    }
  });

  it('calls only existing AI endpoints with the correct payloads', () => {
    const component = read('components/tenant/ai/record-ai-actions.tsx');
    expect(component).toContain("'/api/tenant/ai/insights'");
    expect(component).toContain("'/api/tenant/ai/summarize'");
    expect(component).toContain("'/api/tenant/ai/email-draft'");
    expect(component).toContain('entity_type: entityType, entity_id: entityId');
    expect(component).toContain('contact_id: entityId');
    expect(component).toContain('deal_id: entityId');
    for (const path of [
      'app/api/tenant/ai/insights/route.ts',
      'app/api/tenant/ai/summarize/route.ts',
      'app/api/tenant/ai/email-draft/route.ts',
    ]) {
      expect(existsSync(join(ROOT, path))).toBe(true);
    }
  });

  it('hides the draft action from users without edit permission', () => {
    const component = read('components/tenant/ai/record-ai-actions.tsx');
    expect(component).toContain("b.kind !== 'draft' || canEdit");
  });

  it('does not introduce a new ai_activity action vocabulary', () => {
    const component = read('components/tenant/ai/record-ai-actions.tsx');
    expect(component).not.toMatch(/action:\s*['"][a-z_]+['"]/);
  });
});
