import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(process.cwd(), 'app/api/tenant/webhooks/dlq/route.ts'), 'utf8');
describe('DLQ bulk operations are bounded (#3948)', () => {
  it('caps retry and purge at 50 ids', () => { expect((src.match(/ids\.length > 50/g) ?? []).length).toBe(2); });
  it('caps retry_all at 50 entries', () => { expect(src).toContain('limit: 50, offset: 0, status: '); });
  it('uses canonical envelope for the new limit error', () => { expect(src).toContain("apiFail('BATCH_TOO_LARGE'"); });
});
