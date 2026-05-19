import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { plans, tenants } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

function flatten(prefix: string, obj: any): Record<string, string> {
  const r: Record<string,string> = {};
  for (const [k,v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) { v.forEach((item,i) => { if (typeof item==='object') Object.assign(r, flatten(`${key}[${i}]`, item)); else r[`${key}[${i}]`]=String(item); }); }
    else if (typeof v === 'object') Object.assign(r, flatten(key, v));
    else r[key] = String(v);
  }
  return r;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error:'Admin required' }, { status:403 });
    
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return NextResponse.json({ error:'Stripe not configured — add STRIPE_SECRET_KEY' }, { status:503 });
    
    const { plan_id } = await req.json();
    
    const [plan] = await db.select()
      .from(plans)
      .where(and(eq(plans.id, plan_id), eq(plans.isActive, true)))
      .limit(1);

    const [tenant] = await db.select({
      id: tenants.id,
      name: tenants.name,
      billingEmail: tenants.billingEmail,
      stripeCustomerId: tenants.stripeCustomerId
    })
    .from(tenants)
    .where(eq(tenants.id, ctx.tenantId))
    .limit(1);

    if (!plan) return NextResponse.json({ error:'Plan not found' }, { status:404 });
    
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const currency = process.env['STRIPE_CURRENCY'] || 'usd';
    const billingInterval = process.env['STRIPE_DEFAULT_INTERVAL'] || 'month';
    
    const unitAmount = Math.round(Number(plan.price ?? plan.priceMonthly ?? 0) * 100);

    const sessionData: any = {
      mode: 'subscription', 
      payment_method_types: ['card'],
      line_items: [{ 
        price_data: { 
          currency, 
          recurring: { interval: billingInterval }, 
          unit_amount: unitAmount, 
          product_data: { name: `NuCRM ${plan.name}` } 
        }, 
        quantity: 1 
      }],
      metadata: { tenant_id: ctx.tenantId, plan_id },
      success_url: `${appUrl}/tenant/settings/billing?upgraded=1`,
      cancel_url:  `${appUrl}/tenant/settings/billing`,
    };

    if (tenant?.stripeCustomerId) sessionData.customer = tenant.stripeCustomerId;
    else if (tenant?.billingEmail) sessionData.customer_email = tenant.billingEmail;

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${stripeKey}`, 'Content-Type':'application/x-www-form-urlencoded' },
      body: new URLSearchParams(flatten('', sessionData)).toString(),
    });

    const session = await res.json() as any;
    if (!res.ok) return NextResponse.json({ error: session.error?.message ?? 'Stripe error' }, { status:400 });
    
    return NextResponse.json({ url: session.url });
  } catch (err: any) { 
    return NextResponse.json({ error: err.message }, { status:500 }); 
  }
}
