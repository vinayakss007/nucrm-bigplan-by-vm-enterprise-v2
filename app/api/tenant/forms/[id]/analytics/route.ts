import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { forms } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';

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
