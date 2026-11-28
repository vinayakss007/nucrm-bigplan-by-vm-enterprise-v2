/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { chat, GatewayError } from '@/lib/ai/gateway';
import { createNotification } from '@/lib/notifications';

export async function runAiDraftAction(input: {
  tenantId: string;
  userId: string;
  prompt: string;
  failures: string[];
}): Promise<void> {
  const { tenantId, userId, prompt, failures } = input;
  try {
    const resp = await chat({
      tenantId,
      userId,
      action: 'draft',
      system: 'You are a CRM assistant. Write a short, professional draft using only the facts supplied. Do not invent facts.',
      messages: [{ role: 'user', content: prompt }],
      metadata: { feature: 'automation_ai_draft' },
    });
    const stored = await createNotification({
      userId,
      tenantId,
      type: 'system',
      title: 'AI draft ready for review',
      body: resp.text.slice(0, 1000),
      link: '/tenant/ai/activity',
    });
    if (!stored) failures.push('ai_draft: notification was not persisted');
  } catch (err) {
    if (err instanceof GatewayError) failures.push(`ai_draft: AI provider unavailable (${err.code})`);
    else throw err;
  }
}
