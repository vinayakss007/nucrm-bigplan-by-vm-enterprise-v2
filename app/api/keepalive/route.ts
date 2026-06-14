import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';

/**
 * Keep-Alive Endpoint
 * 
 * Simple query to keep Neon connection warm
 * Called every 5 minutes by client-side service
 */
export async function POST(_request: NextRequest) {
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1 as ping`);
    const duration = Date.now() - start;
    
    return NextResponse.json({
      ok: true,
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[KeepAlive] Error:', err);
    return apiError(err, "Internal server error", 500);
  }
}

export async function GET() {
  return POST({} as NextRequest);
}
