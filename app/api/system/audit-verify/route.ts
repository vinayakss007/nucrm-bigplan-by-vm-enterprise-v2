import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { auditLogs } from '@/drizzle/schema';
import { asc } from 'drizzle-orm';
import { verifyAuditChain } from '@/lib/audit';

/**
 * GET /api/system/audit-verify
 * Verifies the integrity of the audit log hash chain.
 * Protected: superadmin only.
 *
 * Returns the chain verification result — any tampered or missing entries.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get('limit') || '1000'), 10000);

    // Fetch audit entries ordered by creation (chain order)
    const entries = await db
      .select({
        id: auditLogs.id,
        hash: auditLogs.hash,
        previousHash: auditLogs.previousHash,
        tenantId: auditLogs.tenantId,
        userId: auditLogs.userId,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .orderBy(asc(auditLogs.createdAt))
      .limit(limit);

    // Verify chain integrity
    const result = verifyAuditChain(entries);

    return NextResponse.json({
      data: {
        total_entries: entries.length,
        chain_valid: result.valid,
        broken_links: result.brokenLinks || [],
        first_entry_at: entries[0]?.createdAt ?? null,
        last_entry_at: entries[entries.length - 1]?.createdAt ?? null,
        verified_at: new Date().toISOString(),
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
