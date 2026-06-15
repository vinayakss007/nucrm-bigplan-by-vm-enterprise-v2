import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { generateExportData } from '@/lib/export';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.export' as string);
    if (deny) return deny;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || undefined;

    const csv = await generateExportData({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entityType: 'contacts',
      filters: { q }
    });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="contacts_${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[contacts export]', err);
    return apiError(err);
  }
}
