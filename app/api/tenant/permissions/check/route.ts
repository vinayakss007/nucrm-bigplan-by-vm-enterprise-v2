import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, can } from '@/lib/auth/middleware';
import { readJsonBody } from '@/lib/api/validate';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { permission } = await readJsonBody(request);
    if (!permission) return NextResponse.json({ error: 'permission required' }, { status: 400 });
    return NextResponse.json({ allowed: can(ctx, permission), roleSlug: ctx.roleSlug });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}
