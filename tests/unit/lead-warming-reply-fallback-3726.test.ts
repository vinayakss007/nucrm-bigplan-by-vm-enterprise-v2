/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3726 — the rule-based fallback must classify the LEAD's reply, not the
 * provider's body, and must not read a rejection as positive interest.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const chatMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ai/gateway', () => ({ chat: chatMock }));
vi.mock('@/drizzle/db', () => ({ db: {} }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn() }));
vi.mock('@/lib/ai/sentiment', () => ({ updateContactDealsSentiment: vi.fn() }));
vi.mock('@/drizzle/schema', () => ({ contacts: {}, tasks: {} }));
vi.mock('@/drizzle/schema/lead-warming', () => ({
  leadWarmingReplies: {},
  leadWarmingCampaigns: {},
  leadWarmingMessages: {},
}));

import { analyzeReply } from '@/lib/lead-warming/reply-analyzer';

const input = (replyContent: string) => ({
  tenantId: 'tenant-1',
  userId: 'user-1',
  replyContent,
  originalMessageBody: 'Hi, would you like a demo?',
  channel: 'email' as const,
});

beforeEach(() => {
  chatMock.mockReset();
});

describe('#3726 lead-warming reply fallback', () => {
  it('a rejection is not classified as interested when the AI gateway throws', async () => {
    chatMock.mockRejectedValue(new Error('gateway down'));
    const result = await analyzeReply(input('Not interested, thanks'));
    expect(result.intent).toBe('not_interested');
    expect(result.sentimentScore).toBeLessThan(0);
    expect(result.requiresFollowUp).toBe(false);
  });

  it('genuine interest is still classified as interested', async () => {
    chatMock.mockRejectedValue(new Error('gateway down'));
    const result = await analyzeReply(input('I am interested, please send pricing'));
    expect(result.intent).toBe('interested');
    expect(result.requiresFollowUp).toBe(true);
  });

  it('an unparseable provider response is ignored in favour of the lead reply', async () => {
    // The provider body contains "out of office" and "interested"; neither
    // may decide the intent — only the lead's words may.
    chatMock.mockResolvedValue({ text: 'Sorry, I am out of office and cannot answer. Interested?' });
    const result = await analyzeReply(input('Not interested, thanks'));
    expect(result.intent).toBe('not_interested');
    expect(result.requiresFollowUp).toBe(false);
  });

  it('an interested lead is not lost when the provider returns an error page', async () => {
    chatMock.mockResolvedValue({ text: '<html><body>502 Bad Gateway — out of office</body></html>' });
    const result = await analyzeReply(input('I am interested, send me details'));
    expect(result.intent).toBe('interested');
    expect(result.requiresFollowUp).toBe(true);
  });
});
