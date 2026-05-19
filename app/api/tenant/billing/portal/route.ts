import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error:'Admin required' }, { status:403 });
    
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return NextResponse.json({ error:'Stripe not configured' }, { status:503 });
    
    const [tenant] = await db.select({ stripeCustomerId: tenants.stripeCustomerId })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);

    if (!tenant?.stripeCustomerId) return NextResponse.json({ error:'No billing account. Upgrade first.' }, { status:404 });
    
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${stripeKey}`, 'Content-Type':'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ customer: tenant.stripeCustomerId, return_url: `${appUrl}/tenant/settings/billing` }).toString(),
    });
    const session = await res.json() as any;
    if (!res.ok) return NextResponse.json({ error: session.error?.message ?? 'Stripe error' }, { status:400 });
    
    return NextResponse.json({ url: session.url });
  } catch (err: any) { 
    return NextResponse.json({ error: err.message }, { status:500 }); 
  }
}
