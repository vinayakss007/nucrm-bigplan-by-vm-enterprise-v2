/**
 * Seed module: Deals (35 records)
 *
 * Creates deals across the sales and enterprise pipelines
 * with varied stages, values, and close dates.
 */
import * as schema from '../../drizzle/schema';
import { IDS } from './ids';
import { logSection, logDone, futureDate, pastDate } from './helpers';
import type { SeedDb } from './types';

const dealTitles = [
  'CRM License Deal', 'Enterprise Upgrade', 'Annual Subscription', 'Custom Integration',
  'Platform Migration', 'Support Contract', 'Training Package', 'API Access Deal',
  'Multi-Seat License', 'Premium Support', 'Data Analytics Add-on', 'White-Label Agreement',
  'Consulting Engagement', 'Security Audit', 'Performance Optimization', 'Cloud Migration',
  'Compliance Package', 'AI Module Upsell', 'Channel Partnership', 'Reseller Agreement',
  'Proof of Concept', 'Pilot Program', 'Volume Discount Deal', 'Strategic Partnership',
  'Renewal Deal', 'Expansion Deal', 'New Business Win', 'Competitive Displacement',
  'Referral Deal', 'Inbound Deal', 'Outbound Deal', 'Event Lead Deal',
  'Executive Sponsorship', 'Technical Evaluation', 'Budget Approval',
];

export async function seedDeals(db: SeedDb): Promise<void> {
  logSection('Seeding Deals');

  const userIds = Object.values(IDS.users);
  const allStages = [
    IDS.stages.lead, IDS.stages.qualified, IDS.stages.proposal,
    IDS.stages.negotiation, IDS.stages.closedWon, IDS.stages.closedLost,
    IDS.stages.discovery, IDS.stages.evaluation, IDS.stages.poc,
    IDS.stages.contract, IDS.stages.entWon, IDS.stages.entLost,
  ];

  const dealsValues = Array.from({ length: 35 }, (_, i) => {
    const isSalesPipeline = i < 20;
    const pipelineId = isSalesPipeline ? IDS.pipelines.sales : IDS.pipelines.enterprise;
    const stageId = isSalesPipeline
      ? allStages[i % 6]
      : allStages[6 + (i % 6)];
    return {
      id: IDS.deals[i],
      tenantId: IDS.tenant,
      contactId: IDS.contacts[i % 55],
      companyId: IDS.companies[i % 30],
      pipelineId,
      stageId,
      title: dealTitles[i],
      amount: String(5000 + (i * 14321) % 495000),
      closeDate: i % 3 === 0 ? pastDate(i * 3) : futureDate(i * 7),
      assignedTo: userIds[i % 4],
    };
  });

  await db.insert(schema.deals).values(dealsValues);
  logDone('deals', 35);
}
