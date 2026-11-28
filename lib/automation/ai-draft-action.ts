/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { chat, GatewayError } from '@/lib/ai/gateway';
import { createNotification } from '@/lib/notifications';

export async function runAiDraft(input: {
  prompt: string;
  userId: string;
  tenantId: string;
}): Promise<string[]> {
  if (!input.prompt) return [];
  try {
    const resp = await chat({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'draft',
      system: 'You are a CRM assistant. Write a short, professional draft using only the facts supplied. Do not invent facts.',
      messages: [{ role: 'user', content: input.prompt }],
      metadata: { feature: 'automation_ai_draft' },
    });
    const stored = await createNotification({
      userId: input.userId,
      tenantId: input.tenantId,
      type: 'system',
      title: 'AI draft ready for review',
      body: resp.text.slice(0, 1000),
      link: '/tenant/ai/activity',
    });
    return stored ? [] : ['ai_draft: notification was not persisted'];
  } catch (err) {
    if (err instanceof GatewayError) return [`ai_draft: AI provider unavailable (${err.code})`];
    throw err;
  }
}
