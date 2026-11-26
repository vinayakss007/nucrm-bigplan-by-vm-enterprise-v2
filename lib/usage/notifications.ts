/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Usage notifications — fire alerts when a tenant trips a plan limit.
 *
 * Runs fire-and-forget. Throttled by the `notified` flag on `limit_violations`
 * so a single hot loop does not spam the same channel.
 */
import { withTenantDb } from '@/lib/db';
import { NO_USER_SENTINEL } from '@/lib/db/rls';
import { tenants, users, limitViolations } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { sendEmail, sendWebhookNotification, sendTelegram } from '@/lib/email/service';
import { logger } from '@/lib/logger';
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

  // #3405: the tenant row and the violation claim run on one branded client.
  const tenantRow = await withTenantDb(hit.tenantId, NO_USER_SENTINEL, async (db) =>
    db
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug, ownerId: tenants.ownerId })
      .from(tenants)
      .where(eq(tenants.id, hit.tenantId))
      .limit(1));
  const tenant = tenantRow[0];
  if (!tenant) return;

  // Only mark + send once per 24h window per (tenant, type).
  const updated = await withTenantDb(hit.tenantId, NO_USER_SENTINEL, async (db) =>
    db
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
      .returning({ id: limitViolations.id }));
  if (updated.length === 0) return;

  const subject = `[NuCRM] ${labelFor(hit.kind)} limit reached for ${tenant.name}`;
  const message = `Workspace **${tenant.name}** (\`${tenant.slug}\`) hit its ${labelFor(hit.kind)} limit: ${hit.actual}/${hit.limit}. The owner has been notified to upgrade.`;

  // Email the workspace owner. Capture the id so the non-null narrowing
  // survives the async closure passed to withTenantDb.
  const ownerId = tenant.ownerId;
  if (ownerId) {
    const ownerRow = await withTenantDb(hit.tenantId, NO_USER_SENTINEL, async (db) =>
      db
        .select({ email: users.email, fullName: users.fullName })
        .from(users)
        .where(eq(users.id, ownerId))
        .limit(1));
    const owner = ownerRow[0];
    if (owner?.email) {
      // #3045: sendEmail never throws — the .catch() was dead code, so an
      // owner limit alert rejected by the provider was silent even though
      // the violation row was already marked notified.
      const emailResult = await sendEmail({
        to: owner.email,
        subject,
        html: `
          <p>Hi ${owner.fullName ?? 'there'},</p>
          <p>Your workspace <strong>${tenant.name}</strong> just hit its <strong>${labelFor(hit.kind)}</strong> limit (${hit.actual}/${hit.limit}).</p>
          <p>To keep adding records, upgrade your plan from the billing page:</p>
          <p><a href="${process.env['NEXT_PUBLIC_APP_URL'] ?? ''}/tenant/settings/billing">Upgrade plan</a></p>
        `,
      });
      if (!emailResult.success) {
        logger.warn('[notifications] Owner limit-alert email rejected by provider', {
          tenantId: hit.tenantId, channel: 'email',
          error: emailResult.error ?? 'provider failure',
        });
        await withTenantDb(hit.tenantId, NO_USER_SENTINEL, async (db) =>
          db.update(limitViolations)
            .set({ notified: false, notifiedAt: null })
            .where(and(
              eq(limitViolations.id, updated[0]!.id),
              eq(limitViolations.tenantId, hit.tenantId),
              eq(limitViolations.notified, true),
            )));
      }
    }
  }

  // Operator notifications (Discord/Slack + Telegram). Both are no-ops without env config.
  sendWebhookNotification({
    title: subject,
    message,
    color: '#ef4444',
    url: `${process.env['NEXT_PUBLIC_APP_URL'] ?? ''}/superadmin/tenants/${tenant.id}`,
  }).catch((err) => {
    logger.warn('[notifications] Failed to send webhook notification', {
      tenantId: hit.tenantId, channel: 'webhook',
      error: err instanceof Error ? err.message : String(err),
    });
  });

  sendTelegram({
    botToken: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
    chatId: process.env['TELEGRAM_CHAT_ID'] ?? '',
    title: subject,
    message,
    icon: '🛑',
    url: `${process.env['NEXT_PUBLIC_APP_URL'] ?? ''}/superadmin/tenants/${tenant.id}`,
  }).catch((err) => {
    logger.warn('[notifications] Failed to send Telegram notification', {
      tenantId: hit.tenantId, channel: 'telegram',
      error: err instanceof Error ? err.message : String(err),
    });
  });
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
