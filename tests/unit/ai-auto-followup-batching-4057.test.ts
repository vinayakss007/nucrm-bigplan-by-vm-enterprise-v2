import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTO_FOLLOWUP_BATCH_SIZE } from '@/lib/ai/auto-followup';

const src = readFileSync(join(process.cwd(), 'lib/ai/auto-followup.ts'), 'utf8');

describe('auto-followup batching (#4057)', () => {
  it('caps the overdue batch per tenant', () => {
    expect(AUTO_FOLLOWUP_BATCH_SIZE).toBe(25);
    expect(src).toContain('.orderBy(followUps.dueDate)');
    expect(src).toContain('.limit(AUTO_FOLLOWUP_BATCH_SIZE)');
  });

  it('hydrates contacts, companies and deals with one inArray query each', () => {
    expect(src).toContain('inArray(contacts.id, contactIds)');
    expect(src).toContain('inArray(companies.id, companyIds)');
    expect(src).toContain('inArray(deals.id, dealIds)');
    expect(src).not.toContain('where(and(eq(contacts.id, fu.contactId)');
    expect(src).not.toContain('where(and(eq(companies.id, c.companyId)');
    expect(src).not.toContain('where(and(eq(deals.id, fu.dealId)');
  });

  it('bounds LLM concurrency instead of fanning out unboundedly', () => {
    expect(src).toContain('AUTO_FOLLOWUP_LLM_CONCURRENCY = 5');
    expect(src).toContain('Promise.all(overdue.slice(i, i + AUTO_FOLLOWUP_LLM_CONCURRENCY)');
  });

  it('still reports deleted contacts as skipped and keeps deterministic fallback', () => {
    expect(src).toContain("error: 'contact_unavailable'");
    expect(src).toContain('draftText = buildDeterministicDraft({');
  });
});
