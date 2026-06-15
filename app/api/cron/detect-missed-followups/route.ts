import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { verifySecret } from '@/lib/crypto';
import { db } from '@/drizzle/db';
import { followUps } from '@/drizzle/schema';
import { eq, and, lte, isNull, sql } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  if (!verifySecret(req.headers.get('x-cron-secret'), process.env.CRON_SECRET))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const now = new Date();

    const missed = await db.update(followUps)
      .set({
        status: 'missed',
        missedDays: sql`EXTRACT(DAY FROM (${now} - follow_ups.due_date))::int`,
        updatedAt: now,
      })
      .where(and(
        eq(followUps.status, 'pending'),
        lte(followUps.dueDate, now),
        isNull(followUps.deletedAt),
      ))
      .returning({ id: followUps.id, missedDays: followUps.missedDays });

    const totalMissed = missed.length;

    return NextResponse.json({
      ok: true,
      total_missed: totalMissed,
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[detect-missed-followups]', err);
    return apiError(err);
  }
}
