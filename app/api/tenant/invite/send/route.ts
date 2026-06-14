import { logAudit } from '@/lib/audit';
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, plans, invitations, users, tenantMembers } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { sendEmail } from '@/lib/email/service';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

const inviteSendSchema = z.object({
  email: z.string().email('Valid email is required'),
  roleSlug: z.string().trim().max(50).optional().default('sales_rep'),
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'team.invite') && !ctx.isAdmin) {
      return NextResponse.json({ error: 'Permission denied: team.invite required' }, { status: 403 });
    }

    const raw = await request.json();
    const parsed = validateBody(inviteSendSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { email, roleSlug } = parsed.data;
    const emailLower = email.toLowerCase();

    // 1. Check if already a member
    const existingMember = await db.query.tenantMembers.findFirst({
      where: and(
        eq(tenantMembers.tenantId, ctx.tenantId),
        eq(tenantMembers.status, 'active')
      ),
      with: {
        user: {
          where: eq(sql`lower(${users.email})`, emailLower)
        }
      }
    });
    
    // Note: Drizzle relational query might need careful 'with' structure if 'user' isn't directly filtered.
    // Better to use flat query for simplicity here.
    const memberCheck = await db
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(and(
        eq(tenantMembers.tenantId, ctx.tenantId),
        eq(sql`lower(${users.email})`, emailLower),
        eq(tenantMembers.status, 'active')
      ))
      .limit(1);

    if (memberCheck.length > 0) {
      return NextResponse.json({ error: 'This person is already a team member' }, { status: 409 });
    }

    // 2. Check plan user limits
    const tenantRow = await db.query.tenants.findFirst({
      where: eq(tenants.id, ctx.tenantId)
    });

    if (tenantRow?.planId) {
      const planRow = await db.query.plans.findFirst({
        where: eq(plans.id, tenantRow.planId)
      });
      if (planRow && planRow.maxUsers! > 0 && (tenantRow.currentUsers ?? 0) >= planRow.maxUsers!) {
        return NextResponse.json({ error: `User limit (${planRow.maxUsers}) reached. Upgrade your plan.` }, { status: 403 });
      }
    }

    // 3. Upsert invitation
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const [inv] = await db.insert(invitations).values({
      tenantId: ctx.tenantId,
      email: emailLower,
      roleSlug: roleSlug,
      token,
      expiresAt,
      invitedBy: ctx.userId
    })
    .onConflictDoUpdate({
      target: [invitations.tenantId, invitations.email],
      set: {
        roleSlug: roleSlug,
        token,
        expiresAt,
        acceptedAt: null,
        updatedAt: new Date()
      }
    })
    .returning();

    if (!inv) throw new Error('Failed to create invitation');

    // 4. Send email
    const inviter = await db.query.users.findFirst({
      where: eq(users.id, ctx.userId),
      columns: { fullName: true, email: true }
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const inviteUrl = `${appUrl}/auth/invite?token=${inv.token}`;
    const accent = tenantRow?.primaryColor ?? '#7c3aed';
    const roleName = roleSlug.replace(/_/g, ' ');

    await sendEmail({
      to: emailLower,
      subject: `${inviter?.fullName ?? 'Someone'} invited you to join ${tenantRow?.name} on NuCRM`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto">
          <div style="height:4px;background:linear-gradient(90deg,${accent},#4f46e5);border-radius:4px 4px 0 0"></div>
          <div style="padding:40px 32px;background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
            <div style="width:48px;height:48px;background:${accent};border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:20px">
              <span style="color:#fff;font-size:20px;font-weight:700">${tenantRow?.name?.charAt(0)?.toUpperCase()}</span>
            </div>
            <h2 style="margin:0 0 8px;color:#111827;font-size:20px">You're invited to ${tenantRow?.name}</h2>
            <p style="color:#6b7280;margin:0 0 8px;font-size:14px">
              <strong>${inviter?.fullName ?? inviter?.email}</strong> has invited you to join as
              <strong style="text-transform:capitalize">${roleName}</strong>.
            </p>
            <p style="color:#6b7280;margin:0 0 28px;font-size:14px">Click the button below to accept and set up your account.</p>
            <a href="${inviteUrl}" style="display:inline-block;background:${accent};color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
              Accept Invitation →
            </a>
            <p style="color:#9ca3af;font-size:12px;margin-top:24px">
              Link expires in 7 days.<br>
              <a href="${inviteUrl}" style="color:${accent};word-break:break-all">${inviteUrl}</a>
            </p>
          </div>
        </div>`,
      text: `${inviter?.fullName} invited you to ${tenantRow?.name} on NuCRM. Accept: ${inviteUrl}`,
    });

    await logAudit({ 
      tenantId: ctx.tenantId, 
      userId: ctx.userId, 
      action: 'invite_sent', 
      entityType: 'invitation', 
      newData: { email: emailLower, role: roleSlug } 
    });

    return NextResponse.json({ ok: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[invite/send]', err);
    return apiError(err);
  }
}
