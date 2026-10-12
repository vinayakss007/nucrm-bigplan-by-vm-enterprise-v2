/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { bugReportSchema, formatWebhookPayload } from '@/app/api/bug-report/route';

const report = {
  title: 'Import button spins forever',
  description: 'Clicked Import on the contacts page and the spinner never stops.',
  severity: 'major' as const,
  pageUrl: 'https://app.example.test/tenant/contacts',
};
const meta = { email: 'beta@example.test', tenantId: 'tenant-1', userAgent: 'Mozilla/5.0' };

describe('bugReportSchema', () => {
  it('accepts a valid report and defaults severity', () => {
    const parsed = bugReportSchema.parse({ title: 'x'.repeat(6), description: 'y'.repeat(12) });
    expect(parsed.severity).toBe('minor');
  });

  it('rejects too-short title and description', () => {
    expect(bugReportSchema.safeParse({ title: 'hi', description: 'y'.repeat(12) }).success).toBe(false);
    expect(bugReportSchema.safeParse({ title: 'x'.repeat(6), description: 'nope' }).success).toBe(false);
  });

  it('rejects unknown severity values', () => {
    expect(bugReportSchema.safeParse({ ...report, severity: 'catastrophic' }).success).toBe(false);
  });
});

describe('formatWebhookPayload', () => {
  it('formats Discord webhooks as { content } within the 2000-char limit', () => {
    const payload = formatWebhookPayload(
      'https://discord.com/api/webhooks/123/abc',
      report,
      meta,
    ) as { content: string };
    expect(payload.content).toContain('MAJOR — Import button spins forever');
    expect(payload.content).toContain('beta@example.test');
    expect(payload.content.length).toBeLessThanOrEqual(2000);

    const huge = formatWebhookPayload(
      'https://discordapp.com/api/webhooks/123/abc',
      { ...report, description: 'z'.repeat(5000) },
      meta,
    ) as { content: string };
    expect(huge.content.length).toBeLessThanOrEqual(1990);
  });

  it('formats Slack webhooks as { text }', () => {
    const payload = formatWebhookPayload(
      'https://hooks.slack.com/services/T000/B000/XXXX',
      report,
      meta,
    ) as { text: string };
    expect(payload.text).toContain('Import button spins forever');
    expect(payload.text).toContain('tenant-1');
  });

  it('sends structured JSON to any other endpoint', () => {
    const payload = formatWebhookPayload('https://n8n.example.test/webhook/bug', report, meta) as Record<string, unknown>;
    expect(payload.kind).toBe('nucrm-beta-bug-report');
    expect(payload.title).toBe(report.title);
    expect(payload.reporter).toEqual({ email: meta.email, tenantId: meta.tenantId });
  });
});
