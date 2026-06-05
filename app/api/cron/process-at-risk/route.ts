import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq, isNull, and } from 'drizzle-orm';
import { getAtRiskDeals, AtRiskResult } from '@/lib/ai/at-risk';
import { sendEmail } from '@/lib/email/service';
import { formatCurrency } from '@/lib/utils';

export async function POST(request: NextRequest) {
  if (!verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Fetch all active tenants
    const activeTenants = await db.select({ id: tenants.id })
      .from(tenants)
      .where(isNull(tenants.deletedAt));

    let totalDealsFlagged = 0;
    let totalEmailsSent = 0;

    for (const tenant of activeTenants) {
      // 2. Get at-risk deals for this tenant
      const atRiskDeals = await getAtRiskDeals(tenant.id);
      if (atRiskDeals.length === 0) continue;

      totalDealsFlagged += atRiskDeals.length;

      // 3. Group deals by assignee to send consolidated emails
      const byAssignee: Record<string, { email: string, name: string, deals: AtRiskResult[] }> = {};
      
      for (const deal of atRiskDeals) {
        if (!deal.assignedTo || !deal.assignedEmail) continue;
        
        if (!byAssignee[deal.assignedTo]) {
          byAssignee[deal.assignedTo] = {
            email: deal.assignedEmail,
            name: deal.assignedName || 'Sales Hero',
            deals: []
          };
        }
        byAssignee[deal.assignedTo]!.deals.push(deal);
      }

      // 4. Send emails to each assignee
      for (const assigneeId in byAssignee) {
        const { email, name, deals } = byAssignee[assigneeId]!;
        
        await sendEmail({
          to: email,
          subject: `⚠️ Daily Digest: ${deals.length} At-Risk Deals in your Pipeline`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #374151;">
              <h2 style="color: #d97706; margin-bottom: 8px;">At-Risk Deals Warning</h2>
              <p style="font-size: 16px; margin-bottom: 24px;">Hi ${name}, NuCRM identified ${deals.length} deals in your pipeline that require immediate attention.</p>
              
              <div style="space-y: 16px;">
                ${deals.map(deal => `
                  <div style="border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-bottom: 16px; background: #fffcf9;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                      <div style="font-weight: bold; font-size: 16px; color: #111827;">${deal.title}</div>
                      <div style="font-weight: bold; color: #111827;">${formatCurrency(deal.amount)}</div>
                    </div>
                    <div style="font-size: 13px; color: #6b7280; margin-bottom: 12px;">
                      Stage: ${deal.stageName} | Contact: ${deal.contactName}
                    </div>
                    <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #b91c1c;">
                      ${deal.atRisk.reasons.map(r => `<li>${r}</li>`).join('')}
                    </ul>
                    <a href="${process.env.NEXT_PUBLIC_APP_URL}/tenant/deals/${deal.id}" 
                       style="display: inline-block; margin-top: 12px; font-size: 13px; font-weight: 600; color: #7c3aed; text-decoration: none;">
                       View Deal →
                    </a>
                  </div>
                `).join('')}
              </div>

              <div style="margin-top: 32px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center;">
                <a href="${process.env.NEXT_PUBLIC_APP_URL}/tenant/ai/at-risk" 
                   style="background: #7c3aed; color: #fff; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                   Open At-Risk Dashboard
                </a>
              </div>
            </div>
          `,
          text: `Hi ${name}, you have ${deals.length} at-risk deals. View them at ${process.env.NEXT_PUBLIC_APP_URL}/tenant/ai/at-risk`
        }).catch(err => console.error(`[Cron At-Risk] Failed to send email to ${email}:`, err));
        
        totalEmailsSent++;
      }
    }

    return NextResponse.json({
      ok: true,
      tenants_processed: activeTenants.length,
      deals_flagged: totalDealsFlagged,
      emails_sent: totalEmailsSent
    });
  } catch (error: any) {
    console.error('[Cron At-Risk] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
