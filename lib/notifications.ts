import { db } from '@/drizzle/db';
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
  | 'system';

export async function createNotification(opts: {
  userId: string;
  tenantId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  /** Structured entity reference — enables deep-linking from notification list */
  entity_type?: 'contact' | 'deal' | 'task' | 'company' | 'lead' | 'sequence';
  entity_id?: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
}) {
  try {
    // Build enriched metadata that includes entity reference for deep links
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta: Record<string, any> = opts.metadata ?? {};
    if (opts.entity_type) meta['entity_type'] = opts.entity_type;
    if (opts.entity_id)   meta['entity_id']   = opts.entity_id;

    // Auto-derive link from entity if not explicitly provided
    let link = opts.link ?? null;
    if (!link && opts.entity_type && opts.entity_id) {
      const linkMap: Record<string, string> = {
        contact:  `/tenant/contacts/${opts.entity_id}`,
        deal:     `/tenant/deals/${opts.entity_id}`,
        task:     `/tenant/tasks`,
        company:  `/tenant/companies/${opts.entity_id}`,
        lead:     `/tenant/leads/${opts.entity_id}`,
        sequence: `/tenant/sequences/${opts.entity_id}`,
      };
      link = linkMap[opts.entity_type] ?? null;
    }

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
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    logger.error('[notifications] Failed to create notification', {
      type: opts.type,
      userId: opts.userId,
      tenantId: opts.tenantId,
      title: opts.title?.slice(0, 100),
      error: errorMsg,
      stack: errorStack,
    });
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
  entity_type?: 'contact' | 'deal' | 'task' | 'company' | 'lead' | 'sequence';
  entity_id?: string;
}) {
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

    if (!members.length) return;

    // Build entity metadata
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta: Record<string, any> = {};
    if (opts.entity_type) meta['entity_type'] = opts.entity_type;
    if (opts.entity_id)   meta['entity_id']   = opts.entity_id;

    // Auto-derive link from entity if not explicitly provided
    let resolvedLink = opts.link ?? null;
    if (!resolvedLink && opts.entity_type && opts.entity_id) {
      const linkMap: Record<string, string> = {
        contact: `/tenant/contacts/${opts.entity_id}`,
        deal:    `/tenant/deals/${opts.entity_id}`,
        task:    `/tenant/tasks`,
        company: `/tenant/companies/${opts.entity_id}`,
        lead:    `/tenant/leads/${opts.entity_id}`,
        sequence:`/tenant/sequences/${opts.entity_id}`,
      };
      resolvedLink = linkMap[opts.entity_type] ?? null;
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
  } catch (err) {
    logger.error('[notifications] Failed to notify tenant members', {
      tenantId: opts.tenantId,
      type: opts.type,
      error: err instanceof Error ? err.message : String(err),
    });
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
            ilike(users.fullName, `%${username}%`),
            ilike(users.email, `${username}@%`),
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
