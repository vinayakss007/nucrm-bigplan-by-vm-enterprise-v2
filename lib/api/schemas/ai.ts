/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { z } from 'zod';

// ── AI Assistant schema ──
export const aiAssistantSchema = z.object({
  action: z.enum(['draft_email', 'score_lead', 'predict_deal', 'suggest_followup', 'enrich_contact']),
  contact: z.object({
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
    company_name: z.string().max(200).optional(),
    lead_status: z.string().max(50).optional(),
    score: z.coerce.number().optional(),
    notes: z.string().max(300).optional(),
    tags: z.array(z.string()).optional(),
  }).optional().nullable(),
  deal: z.object({
    title: z.string().max(200).optional(),
    stage: z.string().max(50).optional(),
    value: z.coerce.number().optional(),
    probability: z.coerce.number().optional(),
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
    close_date: z.string().max(50).optional(),
  }).optional().nullable(),
  context: z.string().max(500).optional().nullable(),
});

// ── Type exports ──
export type AiAssistantInput = z.infer<typeof aiAssistantSchema>;
