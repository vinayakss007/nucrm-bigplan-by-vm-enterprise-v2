import { NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import pkg from '@/package.json';

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('db timeout')), ms)
  );
}

export async function GET() {
  let database: 'reachable' | 'unreachable' = 'unreachable';

  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      timeout(3000),
    ]);
    database = 'reachable';
  } catch {
    database = 'unreachable';
  }

  if (database !== 'reachable') {
    return NextResponse.json({
      status: 'degraded',
      database: 'unreachable',
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }

  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    version: pkg.version,
  });
}
