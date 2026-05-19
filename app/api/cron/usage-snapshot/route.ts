import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  if (!verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await db.execute(sql`SELECT public.snapshot_tenant_usage() as count`);
    const count = (result.rows[0] as { count: number })?.count;
    return NextResponse.json({ ok: true, snapshots: count });
  } catch (err: any) { 
    console.error('[UsageSnapshot] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 }); 
  }
}
