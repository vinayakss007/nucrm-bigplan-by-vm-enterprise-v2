import { NextResponse } from 'next/server';
import IORedis from 'ioredis';

const REDIS_URL = process.env['REDIS_URL'] || 'redis://localhost:6379';

export async function GET() {
  const conn = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
  });

  try {
    await conn.connect();
    const raw = await conn.get('worker:heartbeat');

    if (!raw) {
      return NextResponse.json({
        status: 'unhealthy',
        worker: 'no heartbeat — worker may be down',
        timestamp: new Date().toISOString(),
      }, { status: 503 });
    }

    const heartbeat = JSON.parse(raw);
    const allRunning = Object.values(heartbeat.workers).every(Boolean);
    const status = allRunning ? 'healthy' : 'degraded';

    return NextResponse.json({
      status,
      worker: heartbeat,
      uptime_seconds: heartbeat.uptime,
      all_workers_running: allRunning,
      timestamp: new Date().toISOString(),
    }, { status: allRunning ? 200 : 200 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[health/worker]', msg);
    return NextResponse.json({
      status: 'error',
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  } finally {
    conn.disconnect();
  }
}
