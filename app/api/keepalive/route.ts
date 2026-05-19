import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';

/**
 * Keep-Alive Endpoint
 * 
 * Simple query to keep Neon connection warm
 * Called every 5 minutes by client-side service
 */
export async function POST(request: NextRequest) {
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1 as ping`);
    const duration = Date.now() - start;
    
    return NextResponse.json({
      ok: true,
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[KeepAlive] Error:', err);
    return NextResponse.json({
      ok: false,
      error: err.message,
    }, { status: 500 });
  }
}

export async function GET() {
  return POST({} as NextRequest);
}
