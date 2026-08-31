/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { auditLogs, users, editHistory } from '@/drizzle/schema';
import { eq, and, or, desc, sql, gte, lte, isNull, inArray } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { escapeLike } from '@/lib/api/sanitize-like';

export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
    const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0'));
    const action = searchParams.get('action');
    const entityType = searchParams.get('entity_type');
    const userId = searchParams.get('user_id');
    const search = searchParams.get('search');
    const dateFrom = searchParams.get('from');
    const dateTo = searchParams.get('to');
    const entityId = searchParams.get('entity_id');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filters: any[] = [
      eq(auditLogs.tenantId, ctx.tenantId),
      isNull(auditLogs.deletedAt),
    ];

    if (action) filters.push(eq(auditLogs.action, action));
    if (entityType) filters.push(eq(auditLogs.entityType, entityType));
    if (userId) filters.push(eq(auditLogs.userId, userId));
    if (entityId) filters.push(eq(auditLogs.entityId, entityId));

    // #661: validate date filters instead of feeding `Invalid Date` into SQL,
    // which silently returned zero (or garbage) rows on a malformed param.
    if (dateFrom) {
      const from = new Date(dateFrom);
      if (Number.isNaN(from.getTime())) {
        return NextResponse.json({ error: 'Invalid "from" date' }, { status: 400 });
      }
      filters.push(gte(auditLogs.createdAt, from));
    }
    if (dateTo) {
      const to = parseInclusiveEnd(dateTo);
      if (!to) {
        return NextResponse.json({ error: 'Invalid "to" date' }, { status: 400 });
      }
      // #661: a bare `YYYY-MM-DD` parses to midnight, which as an `lte` bound
      // excluded that whole day's entries (classic off-by-a-day). parseInclusiveEnd
      // rolls a date-only value to the end of that day so `to` is inclusive.
      filters.push(lte(auditLogs.createdAt, to));
    }
    if (search) {
      // #661: escape LIKE metacharacters so a search for `_`/`%` matches those
      // literal characters instead of acting as wildcards that match everything.
      const term = `%${escapeLike(search)}%`;
      filters.push(
        sql`(${auditLogs.action} ILIKE ${term} OR ${auditLogs.entityType} ILIKE ${term})`
      );
    }

    const where = and(...filters);

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(where);

    const logs = await db.select({
      id: auditLogs.id,
      action: auditLogs.action,
      resource_type: auditLogs.entityType,
      resource_id: auditLogs.entityId,
      created_at: auditLogs.createdAt,
      ip_address: auditLogs.ipAddress,
      old_data: auditLogs.oldData,
      new_data: auditLogs.newData,
      full_name: users.fullName,
      email: users.email,
      user_id: auditLogs.userId,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);

    // #661: correlate edit_history to THIS PAGE's exact (entity_type, entity_id)
    // pairs. The previous version used two INDEPENDENT `IN (...)` subqueries —
    // one over all matching entity_types, one over all matching entity_ids —
    // which is a cartesian correlation: it could attach field-changes from a
    // (type, id) combination that never actually appears together in the result
    // set, and it re-ran the full filtered query twice. We already have every
    // pair we need in `logs`, so match those precisely.
    const entityPairs = Array.from(
      new Map(
        logs
          .filter((l) => l.resource_id)
          .map((l) => [`${l.resource_type}:${l.resource_id}`, {
            type: l.resource_type as string,
            id: l.resource_id as string,
          }]),
      ).values(),
    );

    let fieldChanges: {
      id: string;
      entity_type: string;
      entity_id: string;
      field_name: string;
      field_label: string | null;
      old_value: string | null;
      new_value: string | null;
      change_type: string;
      user_name: string | null;
      user_email: string | null;
      created_at: Date | null;
    }[] = [];

    if (entityPairs.length > 0) {
      // One OR-clause per exact (type, id) pair on this page, so a change only
      // matches when BOTH columns line up. Scoped to the same set of entity_ids
      // via inArray as a cheap index-friendly pre-filter, then narrowed to the
      // precise pairs.
      const pairFilter = or(
        ...entityPairs.map((p) =>
          and(eq(editHistory.entityType, p.type), eq(editHistory.entityId, p.id)),
        ),
      );

      fieldChanges = await db.select({
        id: editHistory.id,
        entity_type: editHistory.entityType,
        entity_id: editHistory.entityId,
        field_name: editHistory.fieldName,
        field_label: editHistory.fieldLabel,
        old_value: editHistory.oldValue,
        new_value: editHistory.newValue,
        change_type: editHistory.changeType,
        user_name: editHistory.userName,
        user_email: editHistory.userEmail,
        created_at: editHistory.createdAt,
      })
      .from(editHistory)
      .where(and(
        eq(editHistory.tenantId, ctx.tenantId),
        inArray(editHistory.entityId, entityPairs.map((p) => p.id)),
        pairFilter,
      ))
      .orderBy(desc(editHistory.createdAt))
      // Generous cap keeps the query bounded for a pathological entity with a
      // huge change history while still covering the whole page in practice.
      .limit(limit * 5);
    }

    const changesByEntity = new Map<string, typeof fieldChanges>();
    for (const change of fieldChanges) {
      const key = `${change.entity_type}:${change.entity_id}`;
      if (!changesByEntity.has(key)) changesByEntity.set(key, []);
      changesByEntity.get(key)!.push(change);
    }

    const logsWithChanges = logs.map(log => ({
      ...log,
      field_changes: log.resource_id
        ? changesByEntity.get(`${log.resource_type}:${log.resource_id}`) ?? []
        : [],
    }));

    return NextResponse.json({
      logs: logsWithChanges,
      total: countResult?.count ?? 0,
      limit,
      offset,
    });
  } catch (error) {
    await logError({ error, context: 'audit GET', requestMethod: 'GET' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});

/**
 * Parse the `to` bound so a date-only value ("2026-08-31") is inclusive of that
 * whole day. A bare date parses to midnight UTC; used as an `lte` bound that
 * excludes everything logged later that day. When the caller passes only a date
 * (no time component) we roll the bound to 23:59:59.999 of that day. Returns
 * null for an unparseable value so the caller can 400. (#661)
 */
function parseInclusiveEnd(value: string): Date | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // Detect a date-only input (no explicit time). Matches "YYYY-MM-DD".
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    d.setUTCHours(23, 59, 59, 999);
  }
  return d;
}
