import { NextRequest, NextResponse } from 'next/server';
import { getAllFlags } from '@/lib/flags';

export async function GET(request: NextRequest) {
  const tenantId = request.headers.get('x-tenant-id') || undefined;
  const userId = request.headers.get('x-user-id') || undefined;

  const flags = await getAllFlags({ tenantId, userId });
  const map: Record<string, boolean> = {};
  for (const f of flags) {
    map[f.key] = f.enabled;
  }
  return NextResponse.json({ flags: map });
}
