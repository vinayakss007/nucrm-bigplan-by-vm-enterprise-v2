import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { forms, formSubmissions } from '@/drizzle/schema';
import { eq, sql, and, gte } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    const form = await db.query.forms.findFirst({
      where: eq(forms.id, id),
      columns: { viewsCount: true, submissionsCount: true, name: true },
    });
    if (!form) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const daysParam = req.nextUrl.searchParams.get('days') || '30';
    const days = Math.min(Math.max(parseInt(daysParam, 10) || 30, 1), 365);
    const since = new Date(Date.now() - days * 86_400_000);

    const rows = await db
      .select({
        date: sql<string>`to_char(${formSubmissions.createdAt}::date, 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(formSubmissions)
      .where(
        and(
          eq(formSubmissions.formId, id),
          gte(formSubmissions.createdAt, since)
        )
      )
      .groupBy(sql`${formSubmissions.createdAt}::date`)
      .orderBy(sql`${formSubmissions.createdAt}::date`);

    return NextResponse.json({
      name: form.name,
      views: form.viewsCount ?? 0,
      submissions: form.submissionsCount ?? 0,
      timeSeries: rows,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    let body: { type?: string } = {};
    try {
      body = await req.json();
    } catch {}

    if (body.type === 'submit') {
      await db
        .update(forms)
        .set({ submissionsCount: sql`${forms.submissionsCount} + 1` })
        .where(eq(forms.id, id));
    } else {
      await db
        .update(forms)
        .set({ viewsCount: sql`${forms.viewsCount} + 1` })
        .where(eq(forms.id, id));
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });
}
