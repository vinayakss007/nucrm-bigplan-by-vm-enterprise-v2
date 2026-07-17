import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { supportTickets, slaPolicies, slaBreaches, users, tenantMembers } from '@/drizzle/schema';
import { eq, and, isNull, sql, not } from 'drizzle-orm';
import { createNotification } from '@/lib/notifications';
import { sendEmail } from '@/lib/email/service';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { checkSLABreach, DEFAULT_SLA_TIMES, type SLADefinition } from '@/lib/sla';

/**
 * SLA Breach Detection Cron
 *
 * Runs periodically (e.g., every 5-10 minutes) to:
 * 1. Check all open/in_progress tickets against their SLA policies
 * 2. Record new breaches in sla_breaches table
 * 3. Escalate existing breaches to higher levels
 * 4. Send in-app notifications and email alerts for breaches
 */
export async function POST(request: NextRequest) {
  if (!verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();

    // Fetch all active SLA policies
    const policies = await db.query.slaPolicies.findMany({
      where: eq(slaPolicies.isActive, true),
    });

    // Build a map: tenantId+priority -> policy
    const policyMap = new Map<string, typeof policies[0]>();
    for (const p of policies) {
      policyMap.set(`${p.tenantId}:${p.priority}`, p);
    }

    // Fetch open/in_progress tickets that haven't been resolved
    const openTickets = await db.select({
      id: supportTickets.id,
      tenantId: supportTickets.tenantId,
      subject: supportTickets.subject,
      priority: supportTickets.priority,
      assignedTo: supportTickets.assignedTo,
      createdAt: supportTickets.createdAt,
      firstResponseAt: supportTickets.firstResponseAt,
      resolvedAt: supportTickets.resolvedAt,
      status: supportTickets.status,
    })
    .from(supportTickets)
    .where(and(
      not(isNull(supportTickets.deletedAt)),
      sql`${supportTickets.status} IN ('open', 'in_progress')`,
    ));

    // Fetch existing breaches to avoid duplicates and track escalation
    const existingBreaches = await db.select({
      id: slaBreaches.id,
      tenantId: slaBreaches.tenantId,
      entityType: slaBreaches.entityType,
      entityId: slaBreaches.entityId,
      breachType: slaBreaches.breachType,
      escalationLevel: slaBreaches.escalationLevel,
      resolvedAt: slaBreaches.resolvedAt,
    })
    .from(slaBreaches)
    .where(eq(slaBreaches.entityType, 'ticket'));

    // Index existing breaches by ticketId+breachType
    const breachIndex = new Map<string, typeof existingBreaches[0]>();
    for (const b of existingBreaches) {
      if (!b.resolvedAt) {
        breachIndex.set(`${b.entityId}:${b.breachType}`, b);
      }
    }

    let newBreaches = 0;
    let escalations = 0;
    let notified = 0;

    for (const ticket of openTickets) {
      // Resolve SLA policy: use assigned policy, or fall back to priority defaults
      const policy = policyMap.get(`${ticket.tenantId}:${ticket.priority}`);
      const sla: SLADefinition = policy ? {
        name: policy.name,
        priority: policy.priority as SLADefinition['priority'],
        responseTimeMinutes: policy.responseTimeMinutes,
        resolutionTimeMinutes: policy.resolutionTimeMinutes,
        escalationRules: (policy.escalationRules as SLADefinition['escalationRules']) ?? [],
      } : {
        name: `default-${ticket.priority}`,
        priority: (ticket.priority as SLADefinition['priority']) || 'medium',
        responseTimeMinutes: DEFAULT_SLA_TIMES[ticket.priority]?.response ?? DEFAULT_SLA_TIMES['medium']!.response,
        resolutionTimeMinutes: DEFAULT_SLA_TIMES[ticket.priority]?.resolution ?? DEFAULT_SLA_TIMES['medium']!.resolution,
        escalationRules: [],
      };

      const result = checkSLABreach(sla, ticket.createdAt, ticket.firstResponseAt, ticket.resolvedAt, now);

      if (!result.breached) continue;

      const existingBreach = breachIndex.get(`${ticket.id}:${result.breachType}`);

      if (existingBreach) {
        // Check if escalation level increased
        if (result.escalationLevel > (existingBreach.escalationLevel ?? 0)) {
          await db.update(slaBreaches)
            .set({ escalationLevel: result.escalationLevel })
            .where(eq(slaBreaches.id, existingBreach.id));

          // Send escalation notification
          await sendEscalationNotification(ticket, result.breachType!, result.escalationLevel, result.minutesOverdue);
          escalations++;
          notified++;
        }
      } else {
        // New breach — record it
        await db.insert(slaBreaches).values({
          tenantId: ticket.tenantId,
          policyId: sla.name,
          entityType: 'ticket',
          entityId: ticket.id,
          breachType: result.breachType!,
          breachedAt: new Date(now.getTime() - result.minutesOverdue * 60 * 1000),
          escalationLevel: result.escalationLevel,
          notifiedUsers: [],
        }).catch((err) => logError({ error: err, context: 'async-catch:sla-breach-insert' }));

        // Send breach notification
        await sendBreachNotification(ticket, result.breachType!, result.minutesOverdue, result.escalationLevel);
        newBreaches++;
        notified++;
      }
    }

    return NextResponse.json({
      ok: true,
      tickets_checked: openTickets.length,
      new_breaches: newBreaches,
      escalations,
      notified,
    });

  } catch (err: unknown) {
    console.error('[SLA Check] Error:', err);
    return apiError(err);
  }
}

async function sendBreachNotification(
  ticket: { id: string; tenantId: string; subject: string; priority: string; assignedTo: string | null },
  breachType: string,
  minutesOverdue: number,
  escalationLevel: number,
) {
  const severity = ticket.priority === 'urgent' || ticket.priority === 'high' ? 'high' : 'medium';
  const breachLabel = breachType === 'response' ? 'first response' : 'resolution';

  // Notify assigned user
  if (ticket.assignedTo) {
    await createNotification({
      userId: ticket.assignedTo,
      tenantId: ticket.tenantId,
      type: 'sla_breach',
      title: `SLA breach: ${breachLabel} overdue by ${minutesOverdue}min`,
      body: `Ticket "${ticket.subject}" (${ticket.priority}) has exceeded its ${breachLabel} SLA.`,
      entity_type: 'contact',
      entity_id: ticket.id,
      metadata: { breach_type: breachType, minutes_overdue: minutesOverdue, escalation_level: escalationLevel },
    }).catch((err) => logError({ error: err, context: 'async-catch:sla-notify' }));
  }

  // Escalation level 2+ sends email to assigned user
  if (escalationLevel >= 2 && ticket.assignedTo) {
    const [user] = await db.select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, ticket.assignedTo))
      .limit(1);

    if (user?.email) {
      await sendEmail({
        to: user.email,
        subject: `[SLA ${severity}] ${breachLabel} overdue: ${ticket.subject}`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px">
          <h3 style="color:#dc2626">SLA ${breachLabel} breach</h3>
          <p><strong>Ticket:</strong> ${ticket.subject}</p>
          <p><strong>Priority:</strong> ${ticket.priority}</p>
          <p><strong>Overdue by:</strong> ${minutesOverdue} minutes</p>
          <p><strong>Escalation level:</strong> ${escalationLevel}</p>
          <a href="${process.env['NEXT_PUBLIC_APP_URL'] ?? ''}/tenant/support" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px">View Ticket →</a>
        </div>`,
      }).catch((err) => logError({ error: err, context: 'async-catch:sla-email' }));
    }
  }
}

async function sendEscalationNotification(
  ticket: { id: string; tenantId: string; subject: string; priority: string; assignedTo: string | null },
  breachType: string,
  escalationLevel: number,
  minutesOverdue: number,
) {
  const breachLabel = breachType === 'response' ? 'first response' : 'resolution';

  // Find tenant admins/managers to notify on escalation
  const admins = await db.select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(and(
      eq(tenantMembers.tenantId, ticket.tenantId),
      eq(tenantMembers.status, 'active'),
      sql`${tenantMembers.roleSlug} IN ('owner', 'admin')`,
    ));

  for (const admin of admins) {
    await createNotification({
      userId: admin.userId,
      tenantId: ticket.tenantId,
      type: 'sla_escalation',
      title: `SLA escalation (L${escalationLevel}): ${ticket.subject}`,
      body: `${breachLabel} overdue by ${minutesOverdue}min — ticket requires immediate attention.`,
      entity_type: 'contact',
      entity_id: ticket.id,
      metadata: { breach_type: breachType, minutes_overdue: minutesOverdue, escalation_level: escalationLevel },
    }).catch((err) => logError({ error: err, context: 'async-catch:sla-escalation-notify' }));
  }
}
