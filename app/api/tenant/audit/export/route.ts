/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { auditLogs, users } from '@/drizzle/schema';
import { eq, and, gte, lte, desc, isNull } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { escapeCSV } from '@/lib/export';

/**
 * GET /api/tenant/audit/export
 * Export audit logs for compliance (SOC2, GDPR, HIPAA).
 *
 * Query params:
 *   from: ISO date (start of range)
 *   to: ISO date (end of range)
 *   format: json | csv (default: json)
 *   limit: max records (default 5000, max 50000)
 *
 * Returns paginated audit entries with user info.
 */
export async function GET(request: NextRequest) {
  try {
    const limited = await rateLimitMutating(request, 'audit-export', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'settings.manage');
    if (deny) return deny;

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const format = searchParams.get('format') || 'json';
    const limit = Math.min(50000, Number(searchParams.get('limit') || '5000'));

    // Build query filters
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filters: any[] = [eq(auditLogs.tenantId, ctx.tenantId), isNull(auditLogs.deletedAt)];
    if (from) filters.push(gte(auditLogs.createdAt, new Date(from)));
    if (to) filters.push(lte(auditLogs.createdAt, new Date(to)));

    const entries = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        userId: auditLogs.userId,
        userEmail: users.email,
        userName: users.fullName,
        metadata: auditLogs.metadata,
        ipAddress: auditLogs.ipAddress,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.userId))
      .where(and(...filters))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    if (format === 'csv') {
      const headers = ['id', 'action', 'entity_type', 'entity_id', 'user_id', 'user_email', 'user_name', 'ip_address', 'created_at'];
      const csvRows = [
        headers.join(','),
        ...entries.map(e => [
          escapeCSV(e.id),
          escapeCSV(e.action),
          escapeCSV(e.entityType),
          escapeCSV(e.entityId),
          escapeCSV(e.userId),
          escapeCSV(e.userEmail),
          escapeCSV(e.userName),
          escapeCSV(e.ipAddress),
          escapeCSV(e.createdAt ? new Date(e.createdAt).toISOString() : ''),
        ].join(',')),
      ];

      return new NextResponse(csvRows.join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="audit-log-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    return NextResponse.json({
      data: entries,
      meta: {
        total: entries.length,
        from: from || null,
        to: to || null,
        exported_at: new Date().toISOString(),
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
