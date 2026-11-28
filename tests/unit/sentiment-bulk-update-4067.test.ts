import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'lib/ai/sentiment.ts'), 'utf8');

describe('contact-deal sentiment batching (#4067)', () => {
  it('writes all open deals with one inArray UPDATE', () => {
    expect(src).toContain('inArray(deals.id, dealIds)');
    expect(src).not.toContain('for (const deal of contactDeals)');
    expect(src).toContain('updateDealSentiment(dealId, tenantId, sentiment)');
  });

  it('keeps the tenant and tombstone predicates on the bulk update', () => {
    expect(src).toContain('eq(deals.tenantId, tenantId)');
    expect(src).toContain('isNull(deals.deletedAt)');
    expect(src).toContain("'{ai_sentiment}'");
  });
});
