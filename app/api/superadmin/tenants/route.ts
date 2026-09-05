/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import crypto from 'crypto';
import { escapeLike } from '@/lib/api/sanitize-like';
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { createTenantSchema, updateTenantSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, users, tenantMembers, plans } from '@/drizzle/schema';
import { eq, and, sql, ilike, desc, or } from 'drizzle-orm';
import { hashPassword } from '@/lib/auth/session';
import { logSuperAdminAction } from '@/lib/audit/super-admin';
import { invalidateTenantCache } from '@/lib/cache';
import { addJob } from '@/lib/queue';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('q')?.trim();
    const status = searchParams.get('status');

    const filters = [];
    if (search) {
      filters.push(
        or(
          ilike(tenants.name, `%${escapeLike(search)}%`),
          ilike(tenants.slug, `%${escapeLike(search)}%`),
          ilike(tenants.billingEmail, `%${escapeLike(search)}%`)
        )
      );
    }
    if (status) {
      filters.push(eq(tenants.status, status));
    }

    const memberCountSubquery = db
      .select({
        tenantId: tenantMembers.tenantId,
        count: sql<number>`count(*)::int`.as('member_count'),
      })
      .from(tenantMembers)
      .where(eq(tenantMembers.status, 'active'))
      .groupBy(tenantMembers.tenantId)
      .as('mc');

    const data = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        status: tenants.status,
        plan_id: tenants.planId,
        billing_email: tenants.billingEmail,
        primary_color: tenants.primaryColor,
        owner_id: tenants.ownerId,
        created_at: tenants.createdAt,
        updated_at: tenants.updatedAt,
        plan_name: plans.name,
        price_monthly: plans.priceMonthly,
        owner_name: users.fullName,
        owner_email: users.email,
        member_count: sql<number>`COALESCE(${memberCountSubquery.count}, 0)`,
        current_users: tenants.currentUsers,
        current_contacts: tenants.currentContacts,
        current_deals: tenants.currentDeals,
        trial_ends_at: tenants.trialEndsAt,
        billing_type: tenants.billingType,
        admin_notes: tenants.adminNotes,
        stripe_customer_id: tenants.stripeCustomerId,
        manual_paid_until: tenants.manualPaidUntil,
      })
      .from(tenants)
      .leftJoin(plans, eq(plans.id, tenants.planId))
      .leftJoin(users, eq(users.id, tenants.ownerId))
      .leftJoin(memberCountSubquery, eq(memberCountSubquery.tenantId, tenants.id))
      .where(and(...filters))
      .orderBy(desc(tenants.createdAt))
      .limit(100);

    return NextResponse.json({ data });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'superadmin/tenants GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const rawBody = await request.json();
    const validated = validateBody(createTenantSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    // Build ONLY from validated data — never re-merge rawBody, which would let
    // unvalidated keys (and un-coerced values) back into the insert path
    const v = validated.data;
    const {
      name, plan_id, status, billing_email, primary_color,
      owner_email, owner_name, owner_password, trial_days,
    } = v;

    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });

    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40) + '-' + Date.now().toString(36);

    const result = await db.transaction(async (tx) => {
      let ownerId = null;
      let temp_password = undefined;

      if (owner_email?.trim()) {
        const [existing] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, owner_email.toLowerCase().trim()))
          .limit(1);

        if (existing) {
          ownerId = existing.id;
        } else {
          const pwd = owner_password || crypto.randomBytes(12).toString('hex') + 'A1!';
          const ownerPasswordHash = await hashPassword(pwd);
          const [newUser] = await tx
            .insert(users)
            .values({
              email: owner_email.toLowerCase().trim(),
              fullName: owner_name || owner_email,
              passwordHash: ownerPasswordHash,
              emailVerified: true,
            })
            .returning({ id: users.id, email: users.email });
          
          ownerId = newUser?.id;
          if (!owner_password) temp_password = pwd;
        }
      }

      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + (trial_days || 14));

      const [tenant] = await tx
        .insert(tenants)
        .values({
          name: name.trim(),
          slug,
          planId: plan_id,
          status,
          billingEmail: billing_email || null,
          primaryColor: primary_color,
          trialEndsAt,
          ownerId,
        })
        .returning();

      if (ownerId) {
        await tx
          .insert(tenantMembers)
          .values({
            tenantId: tenant!.id,
            userId: ownerId,
            roleSlug: 'admin',
            status: 'active',
          })
          .onConflictDoNothing();

        await tx
          .update(users)
          .set({ lastTenantId: tenant!.id })
          .where(eq(users.id, ownerId));
      }

      return { tenant, owner: ownerId ? { id: ownerId, email: owner_email, temp_password } : null };
    });

    logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email || "",
      action: 'tenant.created',
      targetType: 'tenant',
      targetId: result.tenant?.id,
      targetName: name.trim(),
      metadata: { plan_id, status, billing_email, owner_email, trial_days },
    });

    return NextResponse.json({ data: result }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'superadmin/tenants POST', requestMethod: 'POST' });
    return apiError(err);
  }
});

export const PATCH = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const rawBody = await request.json();
    const validated = validateBody(updateTenantSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    // Build the update object ONLY from validated (Zod-coerced) data — never
    // re-merge rawBody, which would let un-validated / un-coerced values through.
    const v = validated.data;
    // id and optimistic-concurrency control fields are NOT part of the entity
    // schema, so reading them from the raw body is correct.
    const id = rawBody.id;
    const expectedUpdatedAt: string | Date | null | undefined = rawBody.expectedUpdatedAt ?? rawBody._updated_at;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    // Map validated snake_case fields to their camelCase Drizzle columns.
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mappedUpdates: any = {};
    if (v.name !== undefined) mappedUpdates.name = v.name;
    if (v.status !== undefined) mappedUpdates.status = v.status;
    if (v.billing_email !== undefined) mappedUpdates.billingEmail = v.billing_email;
    if (v.primary_color !== undefined) mappedUpdates.primaryColor = v.primary_color;
    if (v.plan_id !== undefined) mappedUpdates.planId = v.plan_id;
    if (v.admin_notes !== undefined) mappedUpdates.adminNotes = v.admin_notes;
    if (v.logo_url !== undefined) mappedUpdates.logoUrl = v.logo_url;
    if (v.custom_domain !== undefined) mappedUpdates.customDomain = v.custom_domain;
    if (v.billing_type !== undefined) mappedUpdates.billingType = v.billing_type;
    if (v.manual_paid_until !== undefined && v.manual_paid_until !== null) {
      mappedUpdates.manualPaidUntil = new Date(v.manual_paid_until);
    } else if (v.manual_paid_until === null) {
      mappedUpdates.manualPaidUntil = null;
    }
    if (v.trial_ends_at !== undefined && v.trial_ends_at !== null) {
      mappedUpdates.trialEndsAt = new Date(v.trial_ends_at);
    } else if (v.trial_ends_at === null) {
      mappedUpdates.trialEndsAt = null;
    }

    if (!Object.keys(mappedUpdates).length) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });

    const guard = await concurrencyGuard(db, tenants, id, null, expectedUpdatedAt);
    if (guard) return guard;

    const [row] = await db
      .update(tenants)
      .set({ ...mappedUpdates, updatedAt: new Date() })
      .where(and(eq(tenants.id, id), eq(tenants.updatedAt, new Date(expectedUpdatedAt!))))
      .returning();

    if (!row) return NextResponse.json({ error: 'Tenant was modified by another user — please refresh' }, { status: 409 });

    logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email || "",
      action: mappedUpdates.planId ? 'tenant.plan_changed' : 'tenant.settings_changed',
      targetType: 'tenant',
      targetId: id,
      targetName: row.name,
      tenantId: id,
      metadata: { changes: Object.keys(mappedUpdates) },
    });

    return NextResponse.json({ data: row });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'superadmin/tenants PATCH', requestMethod: 'PATCH' });
    return apiError(err);
  }
});

export const DELETE = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id, hard_delete, confirm_name } = await request.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    if (hard_delete) {
      // Hard-deleting a tenant is the most destructive operation in the system:
      // every table carries `tenant_id ... ON DELETE CASCADE`, so this erases all
      // of that customer's contacts, deals, invoices AND their audit_logs. It is
      // unrecoverable except from a backup. Three guards, none of which existed:
      const [tenant] = await db
        .select({ id: tenants.id, name: tenants.name, deletedAt: tenants.deletedAt })
        .from(tenants)
        .where(eq(tenants.id, id))
        .limit(1);

      if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      // 1. Must be suspended (soft-deleted) first. Previously a single call could
      //    permanently destroy a live, paying tenant.
      if (!tenant.deletedAt) {
        return NextResponse.json(
          {
            error:
              'Tenant must be suspended before it can be permanently deleted. Call DELETE without hard_delete first.',
          },
          { status: 409 }
        );
      }

      // 2. Typed confirmation of the exact name, so an id pasted into the wrong
      //    request body cannot erase the wrong customer.
      if (confirm_name !== tenant.name) {
        return NextResponse.json(
          { error: 'confirm_name must exactly match the tenant name to permanently delete it.' },
          { status: 400 }
        );
      }

      // 3. Record it BEFORE destroying anything, and await it. super_admin_audit_logs
      //    stores tenant_id as plain text with no FK, so it survives the cascade —
      //    but only if the write actually happened. This call was previously not
      //    awaited and ran after the delete, so a failure left no trace of a
      //    permanent deletion.
      await logSuperAdminAction({
        adminId: ctx.userId,
        adminEmail: ctx.user?.email || '',
        action: 'tenant.deleted',
        targetType: 'tenant',
        targetId: id,
        targetName: tenant.name,
        tenantId: id,
        tenantName: tenant.name,
        metadata: { hard_delete: true, confirmed_name: confirm_name },
      });

      // The cascade reaches audit_logs, which migration 0048 protects with an
      // append-only trigger. A lawful tenant erasure is exactly what that
      // escape hatch is for, so opt in explicitly and transaction-scoped —
      // without this the delete fails with a confusing trigger error.
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL app.allow_audit_purge = 'on'`);
        await tx.delete(tenants).where(eq(tenants.id, id));
      });

      // Post-deletion cleanup: purge cached data for the deleted tenant.
      // Redis keys prefixed with the tenant ID (feature flags, widget cache,
      // session data, rate limit counters, etc.) are now orphaned.
      try {
        await invalidateTenantCache(id);
      } catch {
        // Best-effort: if Redis is down the keys will expire via TTL
      }

      // Tenant hard-deletion leaves orphaned resources that need
      // async cleanup via a background job:
      //   - S3 objects (uploaded files, avatars, document attachments)
      //   - External cron/scheduler registrations (e.g. cron-job.org entries)
      //   - Stripe subscriptions & customer objects (cancel via Stripe API)
      //   - Third-party integrations (WhatsApp, Twilio, SendGrid contacts)
      //   - Calendar sync OAuth tokens (Google, Outlook)
      //   - Queued webhook deliveries that reference this tenant
      await addJob('tenant-cleanup', { tenantId: id });
    } else {
      await db
        .update(tenants)
        .set({ status: 'suspended', deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(tenants.id, id));
      logSuperAdminAction({
        adminId: ctx.userId,
        adminEmail: ctx.user?.email || "",
        action: 'tenant.suspended',
        targetType: 'tenant',
        targetId: id,
        metadata: { hard_delete: false },
      });
    }
    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'superadmin/tenants DELETE', requestMethod: 'DELETE' });
    return apiError(err);
  }
});

