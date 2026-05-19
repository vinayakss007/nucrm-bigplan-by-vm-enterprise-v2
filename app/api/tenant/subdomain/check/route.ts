import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

const RESERVED = ['www','app','api','admin','mail','smtp','ftp','ns1','ns2','help','support','billing','dashboard','login','signup','auth','static','cdn','assets'];

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const subdomain = new URL(request.url).searchParams.get('subdomain')?.toLowerCase()?.trim();
    if (!subdomain || subdomain.length < 3) return NextResponse.json({ available:false, reason:'Too short (min 3 chars)' });
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(subdomain)) return NextResponse.json({ available:false, reason:'Only lowercase letters, numbers, hyphens' });
    if (RESERVED.includes(subdomain)) return NextResponse.json({ available:false, reason:'Reserved subdomain' });

    const existing = await db.query.tenants.findFirst({
      where: eq(tenants.subdomain, subdomain),
      columns: { id: true }
    });

    const isCurrent = existing?.id === ctx.tenantId;
    return NextResponse.json({ available: !existing || isCurrent, current: isCurrent });
  } catch (err:any) { 
    return NextResponse.json({ error:err.message }, { status:500 }); 
  }
}
