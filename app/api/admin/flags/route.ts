import { NextRequest, NextResponse } from 'next/server';
import { getAllFlags, isEnabled, setOverride, deleteOverride, DEFINED_FLAGS } from '@/lib/flags';

export async function GET(request: NextRequest) {
  const flags = await getAllFlags();
  return NextResponse.json({ flags });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { key, enabled, tenantIds, userIds, percentage } = body;

  const def = DEFINED_FLAGS.find(f => f.key === key);
  if (!def) {
    return NextResponse.json({ error: `Unknown flag: ${key}` }, { status: 400 });
  }

  await setOverride(key, { enabled, tenantIds, userIds, percentage });
  return NextResponse.json({
    key,
    enabled: await isEnabled(key),
    override: { enabled, tenantIds, userIds, percentage },
  });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });

  await deleteOverride(key);
  return NextResponse.json({ key, enabled: await isEnabled(key) });
}
