import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'app/api/tenant/offers/[quoteId]/send/route.ts'), 'utf8');
const failureIdx = src.indexOf('if (!emailResult.success)');
const auditIdx = src.indexOf('await logAudit(');
const responseIdx = src.indexOf("ok: true,\n      status: 'sent'");

describe('offer send does not claim delivery that failed (#3919)', () => {
  it('checks the email result before the audit and success response', () => {
    expect(failureIdx).toBeGreaterThanOrEqual(0);
    expect(auditIdx).toBeGreaterThan(failureIdx);
    expect(responseIdx).toBeGreaterThan(failureIdx);
  });

  it('reverts the sent stamp and the timeline row on rejection', () => {
    expect(src).toContain("set({ status: quote.status, sentAt: quote.sentAt ?? null, updatedAt: new Date() })");
    expect(src).toContain("activities.metadata}->>'send_id' = ${sendId}");
    expect(src).toContain('send_id: sendId');
  });

  it('returns a canonical 502 with the public URL on rejection', () => {
    expect(src).toContain("apiFail('OFFER_EMAIL_FAILED'");
    expect(src).toContain('{ status: 502 }');
    expect(src).toContain('public_url: link');
  });
});
