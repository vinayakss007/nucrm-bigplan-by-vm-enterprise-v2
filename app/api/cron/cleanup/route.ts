import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { sessions, invitations, passwordResets } from '@/drizzle/schema';
import { lt, and, isNull, sql } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  if (!verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const r: Record<string, number> = {};
    
    // 1. Sessions cleanup
    const sessionsResult = await db.delete(sessions)
      .where(lt(sessions.expiresAt, new Date()));
    r['sessions'] = sessionsResult.rowCount ?? 0;

    // 2. Invitations cleanup: older than 7 days and not accepted
    const invExpiry = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const invitationsResult = await db.delete(invitations)
      .where(and(
        lt(invitations.expiresAt, invExpiry),
        isNull(invitations.acceptedAt)
      ));
    r['invitations'] = invitationsResult.rowCount ?? 0;

    // 3. Password resets cleanup
    const resetsResult = await db.delete(passwordResets)
      .where(lt(passwordResets.expiresAt, new Date()));
    r['resets'] = resetsResult.rowCount ?? 0;

    // 4. Purge trash items older than 30 days
    try {
      const result = await db.execute(sql`SELECT public.purge_trash() as count`);
      const row = result.rows[0] as { count: number };
      r['trash_purged'] = row?.count ?? 0;
    } catch (err) {
      console.error('[Cleanup] Purge trash failed:', err);
      r['trash_purged'] = 0;
    }

    return NextResponse.json({ ok: true, cleaned: r });
  } catch (err: any) { 
    console.error('[Cleanup] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 }); 
  }
}
