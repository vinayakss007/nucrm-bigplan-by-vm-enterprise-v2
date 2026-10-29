/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The `ai_activity` writer behind the AI gateway.
 *
 * Split out of `lib/ai/gateway.ts` because that file sits on the #1843 file-size
 * ratchet and the credit-reservation work in #3359 had nowhere to grow.
 */
import { db } from '@/drizzle/db';
import { aiActivity } from '@/drizzle/schema/ai';
import { logError } from '@/lib/errors-server';

interface LogPayload {
  tenantId: string;
  userId: string | null;
  action: string;
  provider: string;
  model: string | null;
  status: 'success' | 'error' | 'rate_limited' | 'fallback_used';
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  latencyMs: number;
  entityType: string | null;
  entityId: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
}

export type { LogPayload };

export async function logActivity(p: LogPayload): Promise<string | null> {
  try {
    const [row] = await db.insert(aiActivity).values({
      tenantId: p.tenantId,
      userId: p.userId,
      action: p.action,
      provider: p.provider,
      model: p.model,
      status: p.status,
      tokensIn: p.tokensIn,
      tokensOut: p.tokensOut,
      tokensUsed: p.tokensIn + p.tokensOut,
      costCents: p.costCents,
      latencyMs: p.latencyMs,
      entityType: p.entityType,
      entityId: p.entityId,
      errorMessage: p.errorMessage,
      metadata: p.metadata,
    }).returning({ id: aiActivity.id });
    return row?.id ?? null;
  } catch (err) {
    // Never let activity logging break the actual call — but never hide it
    // either. This console.warn is why `ai_activity` holds zero rows while five
    // AI features kept "recording" usage: chk_ai_activity_action rejects
    // insights / email_draft / auto_followup / score_lead / sentiment_analysis,
    // so the usage and credit rows those features are supposed to bill for were
    // discarded without a trace.
    void logError({ error: err, context: `ai gateway activity-log action=${p.action}` });
    return null;
  }
}
