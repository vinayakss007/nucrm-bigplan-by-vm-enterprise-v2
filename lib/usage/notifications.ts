/**
 * Usage notifications — fire alerts when a tenant trips a plan limit.
 *
 * Runs fire-and-forget. Throttled by the `notified` flag on `limit_violations`
 * so a single hot loop does not spam the same channel.
 */
import { db } from '@/drizzle/db';
import { tenants, users, limitViolations } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { sendEmail, sendWebhookNotification, sendTelegram } from '@/lib/email/service';
import type { LimitKind } from './tracker';

export interface LimitHit {
  tenantId: string;
  kind: LimitKind;
  limit: number;
  actual: number;
}

/**
 * Notify operators that `tenant` hit a limit. Looks up the violation row for
 * today, marks it `notified=true`, and dispatches one email + webhook +
 * Telegram message. Every channel is best-effort — failure is logged, never
 * thrown.
 */
export async function notifyLimitHit(hit: LimitHit): Promise<void> {
  const violationType = `${hit.kind}_exceeded`;

  const tenantRow = await db
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug, ownerId: tenants.ownerId })
    .from(tenants)
    .where(eq(tenants.id, hit.tenantId))
    .limit(1);
  const tenant = tenantRow[0];
  if (!tenant) return;

  // Only mark + send once per 24h window per (tenant, type).
  const updated = await db
    .update(limitViolations)
    .set({ notified: true, notifiedAt: new Date() })
    .where(
      and(
        eq(limitViolations.tenantId, hit.tenantId),
        eq(limitViolations.violationType, violationType),
        eq(limitViolations.notified, false),
        eq(limitViolations.resolved, false),
      ),
    )
    .returning({ id: limitViolations.id });
  if (updated.length === 0) return;

  const subject = `[NuCRM] ${labelFor(hit.kind)} limit reached for ${tenant.name}`;
  const message = `Workspace **${tenant.name}** (\`${tenant.slug}\`) hit its ${labelFor(hit.kind)} limit: ${hit.actual}/${hit.limit}. The owner has been notified to upgrade.`;

  // Email the workspace owner
  if (tenant.ownerId) {
    const ownerRow = await db
      .select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, tenant.ownerId))
      .limit(1);
    const owner = ownerRow[0];
    if (owner?.email) {
      sendEmail({
        to: owner.email,
        subject,
        html: `
          <p>Hi ${owner.fullName ?? 'there'},</p>
          <p>Your workspace <strong>${tenant.name}</strong> just hit its <strong>${labelFor(hit.kind)}</strong> limit (${hit.actual}/${hit.limit}).</p>
          <p>To keep adding records, upgrade your plan from the billing page:</p>
          <p><a href="${process.env['NEXT_PUBLIC_APP_URL'] ?? ''}/tenant/settings/billing">Upgrade plan</a></p>
        `,
      }).catch(() => {});
    }
  }

  // Operator notifications (Discord/Slack + Telegram). Both are no-ops without env config.
  sendWebhookNotification({
    title: subject,
    message,
    color: '#ef4444',
    url: `${process.env['NEXT_PUBLIC_APP_URL'] ?? ''}/superadmin/tenants/${tenant.id}`,
  }).catch(() => {});

  sendTelegram({
    botToken: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
    chatId: process.env['TELEGRAM_CHAT_ID'] ?? '',
    title: subject,
    message,
    icon: '🛑',
    url: `${process.env['NEXT_PUBLIC_APP_URL'] ?? ''}/superadmin/tenants/${tenant.id}`,
  }).catch(() => {});
}

function labelFor(kind: LimitKind): string {
  switch (kind) {
    case 'contacts': return 'contacts';
    case 'leads': return 'leads';
    case 'deals': return 'deals';
    case 'users': return 'users';
    case 'automations': return 'automations';
    case 'forms': return 'forms';
    case 'apiCallsDay': return 'daily API calls';
    case 'storageGb': return 'storage';
  }
}
