/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Marketing site pillars, in the order the features index renders them.
 * Each object lives in its own module under ./pillars/ (#422 size split);
 * this file only fixes the order and owns getPillar.
 */
import type { Pillar } from './types';
import { salesPipelinePillar } from './pillars/sales-pipeline';
import { aiPillar } from './pillars/ai';
import { automationPillar } from './pillars/automation';
import { conversationsPillar } from './pillars/conversations';
import { quoteToCashPillar } from './pillars/quote-to-cash';
import { supportPillar } from './pillars/support';
import { analyticsPillar } from './pillars/analytics';
import { platformPillar } from './pillars/platform';

export const PILLARS: Pillar[] = [
  salesPipelinePillar,
  aiPillar,
  automationPillar,
  conversationsPillar,
  quoteToCashPillar,
  supportPillar,
  analyticsPillar,
  platformPillar,
];

export function getPillar(slug: string): Pillar | undefined {
  return PILLARS.find((p) => p.slug === slug);
}
