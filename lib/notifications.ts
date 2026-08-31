/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { db } from '@/drizzle/db';
import { escapeLike } from '@/lib/api/sanitize-like';
import { notifications, tenantMembers, users } from '@/drizzle/schema';
import { logger } from '@/lib/logger';
import { eq, and, ne, sql, ilike, or } from 'drizzle-orm';
import { withTenantContext } from '@/lib/db/rls';

export type NotificationType =
  | 'task_assigned'    | 'task_due'       | 'task_overdue'
  | 'deal_stage'       | 'deal_assigned'  | 'deal_won'
  | 'contact_assigned' | 'mention'
  | 'invite_accepted'  | 'team_joined'
  | 'limit_warning'    | 'trial_expiring'
  | 'lead_warming'
  | 'sla_breach'       | 'sla_escalation'
  | 'contract_renewal' | 'subscription_renewal'
  | 'ai_followup_sent'
  | 'system';

/**
 * Every entity a notification can point at. Declared as a runtime tuple rather
 * than a bare type union so tests (and any future UI) can enumerate the members
 * instead of restating them — a new member added here without a matching entry
 * in ENTITY_LINK_BUILDERS is a compile error, not a silent 404.
 */
export const NOTIFICATION_ENTITY_TYPES = [
  'contact',
  'deal',
  'task',
  'company',
  'lead',
  'sequence',
  'ticket',
  'contract',
  'subscription',
] as const;

export type NotificationEntityType = typeof NOTIFICATION_ENTITY_TYPES[number];

/**
 * Single source of truth for notification deep links. This used to be three
 * identical inline literals (createNotification, notifyTenantMembers, and
 * notifyTenantMembers' retry path), which is exactly how `sequence` came to
 * point at a detail page that does not exist.
 *
 * Every route below is backed by a real page file:
 *   contact      -> app/tenant/contacts/[id]/page.tsx
 *   deal         -> app/tenant/deals/[id]/page.tsx
 *   task         -> app/tenant/tasks/page.tsx       (list route, see note)
 *   company      -> app/tenant/companies/[id]/page.tsx
 *   lead         -> app/tenant/leads/[id]/page.tsx
 *   sequence     -> app/tenant/sequences/page.tsx   (list route, see note)
 *   ticket       -> app/tenant/tickets/[id]/page.tsx
 *   contract     -> app/tenant/contracts/[id]/page.tsx
 *   subscription -> app/tenant/subscriptions/[id]/page.tsx
 *
 * `task` and `sequence` deliberately drop the id: neither has a per-record page
 * reachable from a notification, so linking to the list beats a 404.
 */
const ENTITY_LINK_BUILDERS: Record<NotificationEntityType, (entityId: string) => string> = {
  contact:      (entityId) => `/tenant/contacts/${entityId}`,
  deal:         (entityId) => `/tenant/deals/${entityId}`,
  task:         () => `/tenant/tasks`,
  company:      (entityId) => `/tenant/companies/${entityId}`,
  lead:         (entityId) => `/tenant/leads/${entityId}`,
  sequence:     () => `/tenant/sequences`,
  ticket:       (entityId) => `/tenant/tickets/${entityId}`,
  contract:     (entityId) => `/tenant/contracts/${entityId}`,
  subscription: (entityId) => `/tenant/subscriptions/${entityId}`,
};

/**
 * Derive the in-app deep link for an entity reference, or null when the entity
 * type is not one we know how to route to.
 */
export function deriveEntityLink(entityType: string, entityId: string): string | null {
  const build = ENTITY_LINK_BUILDERS[entityType as NotificationEntityType];
  return build ? build(entityId) : null;
}

/**
 * Best-effort realtime push for a just-committed notification. Isolated in its
 * own try/catch so a realtime problem can never surface as a notification
 * failure, and imported lazily so client bundles never pull ioredis in.
 */
async function pushNotification(
  tenantId: string,
  userId: string,
  notification: { title: string; body?: string; link: string | null; type: string },
): Promise<void> {
  try {
    const { publishNewNotification } = await import('@/lib/realtime/publish');
    await publishNewNotification(tenantId, userId, notification);
  } catch {
    // Realtime is optional; the notification row is already persisted.
  }
}

export async function createNotification(opts: {
  userId: string;
  tenantId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  /** Structured entity reference — enables deep-linking from notification list */
  entity_type?: NotificationEntityType;
  entity_id?: string;
 
 
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  // Enriched metadata and the derived link are computed ONCE, outside the try,
  // so the retry path below writes the same row as the first attempt. It used to
  // recompute neither, silently dropping the deep link and the entity reference
  // from any notification that only succeeded on retry.
  //
  // Spread rather than reuse: assigning into `opts.metadata` directly would
  // mutate the caller's own object as a side effect.
 
 
  const meta: Record<string, unknown> = { ...(opts.metadata ?? {}) };
  if (opts.entity_type) meta['entity_type'] = opts.entity_type;
  if (opts.entity_id)   meta['entity_id']   = opts.entity_id;

  let link = opts.link ?? null;
  if (!link && opts.entity_type && opts.entity_id) {
    link = deriveEntityLink(opts.entity_type, opts.entity_id);
  }

  try {
    await withTenantContext(opts.tenantId, opts.userId, async (tx) => {
      await tx.insert(notifications).values({
        userId: opts.userId,
        tenantId: opts.tenantId,
        type: opts.type,
        title: opts.title.slice(0, 200),
        body: opts.body?.slice(0, 500) ?? '',
        link: link,
        metadata: meta,
      });
    });

    // Push to any connected socket (#644). Deliberately after the commit and
    // never awaited into the failure path: the row is the source of truth, the
    // push is a convenience, and the client polls as a fallback.
    void pushNotification(opts.tenantId, opts.userId, {
      title: opts.title,
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      link,
      type: opts.type,
    });
    return true;
  } catch (_err) {
    // Retry once after a short delay
    try {
      await new Promise(r => setTimeout(r, 200));
      await withTenantContext(opts.tenantId, opts.userId, async (tx) => {
        await tx.insert(notifications).values({
          userId: opts.userId,
          tenantId: opts.tenantId,
          type: opts.type,
          title: opts.title.slice(0, 200),
          body: opts.body?.slice(0, 500) ?? '',
          link,
          metadata: meta,
        });
      });
      // Parity with the first-attempt path: still push over realtime once the
      // retry commits, otherwise a notification that only lands on retry never
      // reaches a connected socket. (#661)
      void pushNotification(opts.tenantId, opts.userId, {
        title: opts.title,
        ...(opts.body !== undefined ? { body: opts.body } : {}),
        link,
        type: opts.type,
      });
      return true;
    } catch (retryErr) {
      // #661: delivery failed after a retry. We log it (so it is never fully
      // silent) AND signal failure to the caller via the return value so
      // delivery-critical flows (invites, security alerts) can react — e.g.
      // surface a warning or fall back to email. Fire-and-forget callers that
      // ignore the result keep their previous behavior.
      logger.error('[notifications] Failed to create notification (retry exhausted)', {
        type: opts.type,
        userId: opts.userId,
        tenantId: opts.tenantId,
        title: opts.title?.slice(0, 100),
        error: retryErr instanceof Error ? retryErr.message : String(retryErr),
      });
      return false;
    }
  }
}

// Notify all members of a tenant (except excludeUserId)
export async function notifyTenantMembers(opts: {
  tenantId: string;
  excludeUserId?: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  entity_type?: NotificationEntityType;
  entity_id?: string;
}): Promise<boolean> {
  try {
    const filters = [
      eq(tenantMembers.tenantId, opts.tenantId),
      eq(tenantMembers.status, 'active')
    ];
    if (opts.excludeUserId) {
      filters.push(ne(tenantMembers.userId, opts.excludeUserId));
    }

    const members = await db.select({ userId: tenantMembers.userId })
      .from(tenantMembers)
      .where(and(...filters));

    if (!members.length) return true;

    // Build entity metadata
 
 
    const meta: Record<string, unknown> = {};
    if (opts.entity_type) meta['entity_type'] = opts.entity_type;
    if (opts.entity_id)   meta['entity_id']   = opts.entity_id;

    // Auto-derive link from entity if not explicitly provided
    let resolvedLink = opts.link ?? null;
    if (!resolvedLink && opts.entity_type && opts.entity_id) {
      resolvedLink = deriveEntityLink(opts.entity_type, opts.entity_id);
    }

    const metaJson = meta;
    const notificationValues = members.map(m => ({
      userId: m.userId,
      tenantId: opts.tenantId,
      type: opts.type,
      title: opts.title.slice(0, 200),
      body: opts.body?.slice(0, 500) ?? '',
      link: resolvedLink,
      metadata: metaJson,
    }));

    await withTenantContext(opts.tenantId, members[0]!.userId, async (tx) => {
      await tx.insert(notifications).values(notificationValues);
    });

    // #661: push over realtime to each recipient. Previously a broadcast only
    // ever hit the DB, so connected clients relied on polling and never got a
    // live update. Best-effort per pushNotification's own isolation.
    for (const m of members) {
      void pushNotification(opts.tenantId, m.userId, {
        title: opts.title,
        ...(opts.body !== undefined ? { body: opts.body } : {}),
        link: resolvedLink,
        type: opts.type,
      });
    }
    return true;
  } catch (_err) {
    // Retry once after a short delay
    try {
      await new Promise(r => setTimeout(r, 200));
      const retryMembers = await db.select({ userId: tenantMembers.userId })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, opts.tenantId),
          eq(tenantMembers.status, 'active'),
          ...(opts.excludeUserId ? [ne(tenantMembers.userId, opts.excludeUserId)] : []),
        ));
      if (retryMembers.length) {
        const retryMeta: Record<string, unknown> = {};
        if (opts.entity_type) retryMeta['entity_type'] = opts.entity_type;
        if (opts.entity_id)   retryMeta['entity_id']   = opts.entity_id;
        let resolvedLink = opts.link ?? null;
        if (!resolvedLink && opts.entity_type && opts.entity_id) {
          resolvedLink = deriveEntityLink(opts.entity_type, opts.entity_id);
        }
        const retryValues = retryMembers.map(m => ({
          userId: m.userId,
          tenantId: opts.tenantId,
          type: opts.type,
          title: opts.title.slice(0, 200),
          body: opts.body?.slice(0, 500) ?? '',
          link: resolvedLink,
          metadata: retryMeta,
        }));
        await withTenantContext(opts.tenantId, retryMembers[0]!.userId, async (tx) => {
          await tx.insert(notifications).values(retryValues);
        });
        for (const m of retryMembers) {
          void pushNotification(opts.tenantId, m.userId, {
            title: opts.title,
            ...(opts.body !== undefined ? { body: opts.body } : {}),
            link: resolvedLink,
            type: opts.type,
          });
        }
      }
      return true;
    } catch (retryErr) {
      logger.error('[notifications] Failed to notify tenant members (retry exhausted)', {
        tenantId: opts.tenantId,
        type: opts.type,
        error: retryErr instanceof Error ? retryErr.message : String(retryErr),
      });
      return false;
    }
  }
}

// Parse @mentions from text and notify mentioned users
export async function processMentions(text: string, tenantId: string, authorId: string, link?: string) {
  const mentions = text.match(/@(\w+)/g);
  if (!mentions) return;

  for (const mention of mentions) {
    const username = mention.slice(1);
    try {
      const [user] = await db.select({ id: users.id })
        .from(users)
        .innerJoin(tenantMembers, eq(tenantMembers.userId, users.id))
        .where(and(
          eq(tenantMembers.tenantId, tenantId),
          eq(tenantMembers.status, 'active'),
          ne(users.id, authorId),
          or(
            ilike(users.fullName, `%${escapeLike(username)}%`),
            ilike(users.email, `${escapeLike(username)}@%`),
            sql`split_part(${users.email}, '@', 1) = ${username}`
          )
        ))
        .limit(1);

      if (user) {
        await createNotification({
          userId: user.id, tenantId, type: 'mention',
          title: `You were mentioned`,
          body: text.slice(0, 150),
          link,
        });
      }
    } catch (err) {
      logger.error('[notifications] Failed to process mention', {
        mention: username,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
