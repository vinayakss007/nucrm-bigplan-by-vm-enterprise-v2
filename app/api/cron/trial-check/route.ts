import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { tenants, users, activities } from '@/drizzle/schema';
import { eq, and, lt, sql, notExists, inArray } from 'drizzle-orm';
import { sendEmail } from '@/lib/email/service';

export async function POST(request: NextRequest) {
  if (!verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error:'Unauthorized' }, { status:401 });
  }
  try {
    let expired=0, warned=0;

    // 1. Expire trials that ended
    const justExpired = await db.update(tenants)
      .set({ status: 'trial_expired' })
      .where(and(
        eq(tenants.status, 'trialing'),
        lt(tenants.trialEndsAt, new Date())
      ))
      .returning({
        id: tenants.id,
        name: tenants.name,
        billingEmail: tenants.billingEmail,
        ownerId: tenants.ownerId
      });

    if (justExpired.length > 0) {
      const tenantIds = justExpired.map(t => t.id);
      const owners = await db.select({
        id: tenants.id,
        ownerEmail: users.email,
        ownerName: users.fullName
      })
      .from(tenants)
      .leftJoin(users, eq(users.id, tenants.ownerId))
      .where(inArray(tenants.id, tenantIds));

      for (const t of justExpired) {
        expired++;
        const owner = owners.find(o => o.id === t.id);
        const to = t.billingEmail || owner?.ownerEmail;
        if (to) {
          await sendEmail({
            to,
            subject: `Your NuCRM trial has ended — upgrade to keep access`,
            html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
              <h2 style="color:#111827">Your free trial has ended</h2>
              <p style="color:#6b7280">Hi \${owner?.ownerName||'there'}, your \${t.name} workspace trial has expired.</p>
              <p style="color:#6b7280">Your data is safe — upgrade within 30 days to regain full access.</p>
              <a href="\${process.env.NEXT_PUBLIC_APP_URL}/tenant/settings/billing" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px">Upgrade Now →</a>
            </div>`,
            text: `Your NuCRM trial for \${t.name} has ended. Upgrade: \${process.env.NEXT_PUBLIC_APP_URL}/tenant/settings/billing`,
          }).catch(()=>{});
        }
      }
    }

    // 2. Warn 3 days before expiry
    const expiringSoon = await db.select({
      id: tenants.id,
      name: tenants.name,
      billingEmail: tenants.billingEmail,
      trialEndsAt: tenants.trialEndsAt,
      ownerEmail: users.email,
      ownerName: users.fullName,
      ownerId: tenants.ownerId
    })
    .from(tenants)
    .leftJoin(users, eq(users.id, tenants.ownerId))
    .where(and(
      eq(tenants.status, 'trialing'),
      sql`\${tenants.trialEndsAt} BETWEEN now() AND now() + interval '3 days 1 hour'`,
      notExists(
        db.select()
          .from(activities)
          .where(and(
            eq(activities.tenantId, tenants.id),
            eq(activities.eventType, 'trial_warning'),
            sql`\${activities.createdAt} > now() - interval '4 days'`
          ))
      )
    ));

    for (const t of expiringSoon) {
      if (!t.trialEndsAt) continue;
      warned++;
      const daysLeft = Math.max(1, Math.ceil((new Date(t.trialEndsAt).getTime()-Date.now())/86400000));
      const to = t.billingEmail || t.ownerEmail;
      if (to) {
        await sendEmail({
          to,
          subject: `⏰ Your NuCRM trial expires in \${daysLeft} day\${daysLeft>1?'s':''}`,
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
            <h2 style="color:#d97706">Trial expiring in \${daysLeft} day\${daysLeft>1?'s':''}</h2>
            <p style="color:#6b7280">Hi \${t.ownerName||'there'}, your \${t.name} workspace trial ends in \${daysLeft} day\${daysLeft>1?'s':''}.</p>
            <p style="color:#6b7280">Upgrade now to keep all your data and team access.</p>
            <a href="\${process.env.NEXT_PUBLIC_APP_URL}/tenant/settings/billing" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px">View Plans →</a>
          </div>`,
          text: `Your NuCRM trial for \${t.name} expires in \${daysLeft} day(s). Upgrade: \${process.env.NEXT_PUBLIC_APP_URL}/tenant/settings/billing`,
        }).catch(()=>{});
      }
      // Mark warned
      if (t.ownerId) {
        await db.insert(activities).values({
          tenantId: t.id,
          userId: t.ownerId,
          eventType: 'trial_warning',
          description: `Trial warning sent — \${daysLeft} days left`,
          entityType: 'tenant',
          entityId: t.id,
          action: 'trial_warning'
        }).catch(()=>{});
      }
    }

    return NextResponse.json({ ok:true, expired, warned });
  } catch (err:any) { 
    console.error('[TrialCheck] Error:', err);
    return NextResponse.json({ error:err.message }, { status:500 }); 
  }
}
