import { db } from '@/drizzle/db';
import { deals, atRiskRules, dealStages, contacts, companies, users } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';

export interface AtRiskResult {
  id: string;
  title: string;
  amount: string;
  stageName: string;
  contactName: string;
  companyName: string | null;
  assignedTo: string | null;
  assignedEmail: string | null;
  assignedName: string | null;
  atRisk: {
    reasons: string[];
    severity: 'high' | 'medium' | 'low';
    idleDays: number;
    stageDays: number;
    currentSentiment: number;
    ruleId?: string;
  };
}

/**
 * Core engine to detect at-risk deals for a specific tenant.
 * Shared between the real-time API and the daily cron job.
 */
export async function getAtRiskDeals(tenantId: string): Promise<AtRiskResult[]> {
  // 1. Fetch all active at-risk rules for this tenant
  const rules = await db.select()
    .from(atRiskRules)
    .where(and(
      eq(atRiskRules.tenantId, tenantId),
      eq(atRiskRules.active, true),
      isNull(atRiskRules.deletedAt)
    ));

  const globalRule = rules.find(r => !r.stageId);
  const stageRules = rules.filter(r => r.stageId);

  // 2. Fetch all open deals with their stage info
  const openDeals = await db.select({
    id: deals.id,
    title: deals.title,
    amount: deals.amount,
    updatedAt: deals.updatedAt,
    stageEnteredAt: deals.stageEnteredAt,
    stageId: deals.stageId,
    stageName: dealStages.name,
    contactFirst: contacts.firstName,
    contactLast: contacts.lastName,
    companyName: companies.name,
    assignedTo: deals.assignedTo,
    assignedEmail: users.email,
    assignedName: users.fullName,
    metadata: deals.metadata,
  })
  .from(deals)
  .leftJoin(dealStages, eq(deals.stageId, dealStages.id))
  .leftJoin(contacts, eq(deals.contactId, contacts.id))
  .leftJoin(companies, eq(deals.companyId, companies.id))
  .leftJoin(users, eq(deals.assignedTo, users.id))
  .where(and(
    eq(deals.tenantId, tenantId),
    isNull(deals.deletedAt),
    // Only open deals
    sql`COALESCE(${deals.metadata}->>'outcome', '') NOT IN ('won', 'lost')`
  ));

  const now = new Date();

  // 3. Apply rules to each deal
  const atRiskDeals: AtRiskResult[] = openDeals.map(deal => {
    // Find matching rule: stage-specific first, then global, then default
    const rule = stageRules.find(r => r.stageId === deal.stageId) || globalRule;
    
    const idleLimit = rule?.maxDaysIdle ?? 14;
    const stageLimit = rule?.maxDaysInStage;
    const sentimentLimit = rule?.sentimentThreshold ?? 30;

    const idleDays = Math.floor((now.getTime() - (deal.updatedAt?.getTime() || 0)) / (1000 * 60 * 60 * 24));
    const stageDays = Math.floor((now.getTime() - (deal.stageEnteredAt?.getTime() || 0)) / (1000 * 60 * 60 * 24));
    
    const currentSentiment = (deal.metadata as { ai_sentiment?: { score?: number } } | undefined)?.ai_sentiment?.score ?? 100;

    const reasons: string[] = [];
    if (idleDays >= idleLimit) reasons.push(`No activity for ${idleDays} days (Limit: ${idleLimit})`);
    if (stageLimit && stageDays >= stageLimit) reasons.push(`Stuck in ${deal.stageName} for ${stageDays} days (Limit: ${stageLimit})`);
    if (currentSentiment < sentimentLimit) reasons.push(`Negative sentiment shift (${currentSentiment}%)`);

    if (reasons.length > 0) {
      return {
        id: deal.id,
        title: deal.title,
        amount: deal.amount || '0',
        stageName: deal.stageName || 'Unknown',
        contactName: `${deal.contactFirst || ''} ${deal.contactLast || ''}`.trim(),
        companyName: deal.companyName,
        assignedTo: deal.assignedTo,
        assignedEmail: deal.assignedEmail,
        assignedName: deal.assignedName,
        atRisk: {
          reasons,
          severity: reasons.length > 1 ? 'high' : 'medium',
          idleDays,
          stageDays,
          currentSentiment,
          ruleId: rule?.id
        }
      };
    }
    return null;
  }).filter(Boolean) as AtRiskResult[];

  return atRiskDeals;
}
