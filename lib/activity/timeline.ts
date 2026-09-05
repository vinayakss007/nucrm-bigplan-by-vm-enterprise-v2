/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #1820 — Unified activity timeline.
 *
 * Activity/history was fragmented across four tables and each detail page read
 * only a subset:
 *   - `activities`      (polymorphic + denormalized FKs) — contact/deal pages
 *   - `leadActivities`  (lead-only)                      — lead page
 *   - `callLogs`        (contact/company/deal)           — contact page (separately)
 *   - `notes`           (polymorphic)                    — not surfaced
 *
 * There was no single chronological feed. `getActivityTimeline` merges the
 * relevant sources for an entity into ONE normalized, time-sorted list.
 *
 * The normalized `TimelineItem` deliberately populates BOTH `created_at` +
 * `performed_at` and BOTH `full_name` + `performed_by_name`, so the existing
 * lead / contact / deal client renderers can consume it without field renames.
 */
import { db } from '@/drizzle/db';
import { activities, leadActivities, callLogs, notes, users } from '@/drizzle/schema';
import { eq, and, or, isNull, desc } from 'drizzle-orm';
import { logError } from '@/lib/errors-server';

export type TimelineEntity = 'contact' | 'deal' | 'lead' | 'company';
export type TimelineSource = 'activity' | 'lead_activity' | 'call' | 'note';

export interface TimelineItem {
  id: string;                 // `${source}:${rowId}` to avoid key collisions
  source: TimelineSource;
  type: string;               // maps to the contact client's ACTIVITY_ICONS keys
  action?: string | null;
  description: string;
  created_at: string;         // ISO — contact & deal clients read this
  performed_at: string;       // ISO — lead client reads this (mirror of created_at)
  full_name?: string | null;         // contact client (actor)
  performed_by_name?: string | null; // lead & deal clients (actor)
  avatar_url?: string | null;
  user_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

const iso = (d: Date | string | null | undefined): string =>
  d ? new Date(d).toISOString() : new Date(0).toISOString();

async function safe<T>(p: Promise<T[]>): Promise<T[]> {
  try {
    return await p;
  } catch (err) {
    await logError({ error: err, context: 'activity/timeline query' });
    return [];
  }
}

/**
 * Build one chronological (newest-first) activity feed for an entity by merging
 * activities + leadActivities + callLogs + notes. Every query is tenant-scoped
 * and skips soft-deleted rows; failures in any one source are swallowed so the
 * feed degrades gracefully rather than breaking the page.
 */
export async function getActivityTimeline(
  entityType: TimelineEntity,
  entityId: string,
  tenantId: string,
  limit = 100,
): Promise<TimelineItem[]> {
  const isLead = entityType === 'lead';

  // ── activities ────────────────────────────────────────────────────────────
  // For contacts/deals the denormalized FK is indexed and well-populated. For
  // leads the denormalized `leadId` was added late, so match the polymorphic
  // (entityType/entityId) pair too. We OR both to be robust.
  const activityFkMatch =
    entityType === 'contact' ? eq(activities.contactId, entityId)
    : entityType === 'deal' ? eq(activities.dealId, entityId)
    : entityType === 'company' ? eq(activities.companyId, entityId)
    : eq(activities.leadId, entityId);

  // ── callLogs (contact/deal/company) ─────────────────────────────────────────
  const callFkMatch =
    entityType === 'contact' ? eq(callLogs.contactId, entityId)
    : entityType === 'deal' ? eq(callLogs.dealId, entityId)
    : entityType === 'company' ? eq(callLogs.companyId, entityId)
    : null;

  // All four sources are independent — fire together (was 4 serial WAN
  // round-trips). Same Promise.all pattern already used by dashboard stats.
  const [activityRows, leadActivityRows, callRows, noteRows] = await Promise.all([
  safe(
    db
      .select({
        id: activities.id,
        eventType: activities.eventType,
        action: activities.action,
        description: activities.description,
        metadata: activities.metadata,
        createdAt: activities.createdAt,
        userId: activities.userId,
        full_name: users.fullName,
        avatar_url: users.avatarUrl,
      })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.userId))
      .where(
        and(
          eq(activities.tenantId, tenantId),
          isNull(activities.deletedAt),
          or(activityFkMatch, and(eq(activities.entityType, entityType), eq(activities.entityId, entityId))),
        ),
      )
      .orderBy(desc(activities.createdAt))
      .limit(limit),
  ),

  // ── leadActivities (leads only) ─────────────────────────────────────────────
  isLead
    ? safe(
        db
          .select({
            id: leadActivities.id,
            activityType: leadActivities.activityType,
            description: leadActivities.description,
            subject: leadActivities.subject,
            body: leadActivities.body,
            metadata: leadActivities.metadata,
            performedAt: leadActivities.performedAt,
            performedBy: leadActivities.performedBy,
            full_name: users.fullName,
            avatar_url: users.avatarUrl,
          })
          .from(leadActivities)
          .leftJoin(users, eq(users.id, leadActivities.performedBy))
          .where(and(eq(leadActivities.leadId, entityId), eq(leadActivities.tenantId, tenantId), isNull(leadActivities.deletedAt)))
          .orderBy(desc(leadActivities.performedAt))
          .limit(limit),
      )
    : Promise.resolve([]),

  // ── callLogs (contact/deal/company) ─────────────────────────────────────────
  callFkMatch
    ? safe(
        db
          .select({
            id: callLogs.id,
            direction: callLogs.direction,
            duration: callLogs.duration,
            notes: callLogs.notes,
            phoneNumber: callLogs.phoneNumber,
            createdAt: callLogs.createdAt,
            userId: callLogs.userId,
            full_name: users.fullName,
            avatar_url: users.avatarUrl,
          })
          .from(callLogs)
          .leftJoin(users, eq(users.id, callLogs.userId))
          .where(and(callFkMatch, eq(callLogs.tenantId, tenantId), isNull(callLogs.deletedAt)))
          .orderBy(desc(callLogs.createdAt))
          .limit(limit),
      )
    : Promise.resolve([]),

  // ── notes (polymorphic) ──────────────────────────────────────────────────────
  safe(
    db
      .select({
        id: notes.id,
        content: notes.content,
        createdAt: notes.createdAt,
        createdBy: notes.createdBy,
        full_name: users.fullName,
        avatar_url: users.avatarUrl,
      })
      .from(notes)
      .leftJoin(users, eq(users.id, notes.createdBy))
      .where(and(eq(notes.entityType, entityType), eq(notes.entityId, entityId), eq(notes.tenantId, tenantId), isNull(notes.deletedAt)))
      .orderBy(desc(notes.createdAt))
      .limit(limit),
  ),
  ]);

  // ── normalize ────────────────────────────────────────────────────────────────
  const items: TimelineItem[] = [];

  for (const a of activityRows) {
    const when = iso(a.createdAt);
    items.push({
      id: `activity:${a.id}`,
      source: 'activity',
      type: a.eventType || a.action || 'activity',
      action: a.action,
      description: a.description || a.eventType || 'Activity',
      created_at: when,
      performed_at: when,
      full_name: a.full_name,
      performed_by_name: a.full_name,
      avatar_url: a.avatar_url,
      user_id: a.userId,
      metadata: (a.metadata as Record<string, unknown> | null) ?? null,
    });
  }

  for (const la of leadActivityRows) {
    const when = iso(la.performedAt);
    const text = la.description || la.subject || la.body || la.activityType || 'Activity';
    items.push({
      id: `lead_activity:${la.id}`,
      source: 'lead_activity',
      type: la.activityType || 'activity',
      description: text,
      created_at: when,
      performed_at: when,
      full_name: la.full_name,
      performed_by_name: la.full_name,
      avatar_url: la.avatar_url,
      user_id: la.performedBy,
      metadata: (la.metadata as Record<string, unknown> | null) ?? null,
    });
  }

  for (const c of callRows) {
    const when = iso(c.createdAt);
    const dir = c.direction === 'inbound' ? 'Inbound' : 'Outbound';
    const mins = c.duration ? ` (${Math.round((c.duration as number) / 60)}m)` : '';
    const desc = c.notes ? c.notes : `${dir} call${c.phoneNumber ? ` · ${c.phoneNumber}` : ''}${mins}`;
    items.push({
      id: `call:${c.id}`,
      source: 'call',
      type: 'call',
      description: desc,
      created_at: when,
      performed_at: when,
      full_name: c.full_name,
      performed_by_name: c.full_name,
      avatar_url: c.avatar_url,
      user_id: c.userId,
      metadata: { direction: c.direction, duration: c.duration, phone_number: c.phoneNumber },
    });
  }

  for (const n of noteRows) {
    const when = iso(n.createdAt);
    items.push({
      id: `note:${n.id}`,
      source: 'note',
      type: 'note',
      description: n.content || 'Note',
      created_at: when,
      performed_at: when,
      full_name: n.full_name,
      performed_by_name: n.full_name,
      avatar_url: n.avatar_url,
      user_id: n.createdBy,
      metadata: null,
    });
  }

  items.sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : 0));
  return items.slice(0, limit);
}
