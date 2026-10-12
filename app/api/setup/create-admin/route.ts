/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withSecurityContext, setTenantContext } from '@/lib/db/rls';
import { users, tenants, tenantMembers, plans, roles, onboardingProgress, sessions, pipelines, dealStages } from '@/drizzle/schema';
import { eq, count } from 'drizzle-orm';
import { hashPassword, createToken, hashToken, setSessionCookie, validatePassword } from '@/lib/auth/session';
import { installDefaultModules } from '@/lib/modules/auto-install';
import { logError } from '@/lib/errors-server';
import { readJsonBody, validateBody } from '@/lib/api/validate';

const createAdminSchema = z.object({
  full_name: z.string().min(1, 'Full name is required'),
  email: z.string().email('Valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  workspace_name: z.string().min(1, 'Workspace name is required'),
  setup_key: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    let body;
    try { body = await readJsonBody(request); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    // Validate the request body before any DB writes (#1072). Returns a 400
    // with field-level details on invalid input via the shared helper.
    const validated = validateBody(createAdminSchema, body);
    if (validated instanceof NextResponse) return validated;
    const { full_name, email, password, workspace_name } = validated.data;

    // Only works if zero super admin users exist
    const [existing] = await withSecurityContext(async (tx) =>
      await tx
        .select({ count: count() })
        .from(users)
        .where(eq(users.isSuperAdmin, true))
    );

    if ((existing?.count ?? 0) > 0) {
      return NextResponse.json({ error: 'Platform Super Admin already exists. Only one is allowed.' }, { status: 403 });
    }

    // #1254: in production the endpoint requires the server-side SETUP_KEY
    // (dev remains open so local bootstrap works without extra config).
    // Accepted via the x-setup-key header OR the setup_key body field, since
    // some clients cannot attach custom headers to this bootstrap call.
    if (process.env.NODE_ENV === 'production') {
      const expectedKey = process.env.SETUP_KEY;
      const providedKey = request.headers.get('x-setup-key') ?? validated.data.setup_key;
      if (!expectedKey || !providedKey || providedKey !== expectedKey) {
        return NextResponse.json({ error: 'Valid x-setup-key header or setup_key field required' }, { status: 403 });
      }
    }

    const passwordError = validatePassword(password);
    if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

    const passwordHash = await hashPassword(password);
    const emailLower = email.trim().toLowerCase();
    const fullNameTrim = full_name.trim();

    // PP-010: this whole sequence creates a user and a tenant before any
    // identity exists, so `users_insert_auth` and `tenants_authenticated_insert`
    // (both requiring app.current_user) could never be satisfied — the route
    // 423'd with `row-level security` on its very first write. The security
    // context also makes the pre-check above able to SEE a super admin, which
    // it never could before: under RLS that count was always 0, so the
    // "only one super admin" guard silently allowed an unlimited number.
    const result = await withSecurityContext(async (tx) => {
      // 1. Create super admin user
      // #2459: `.returning()` is `RETURNING *`, and `users` is 36 columns
      // (drizzle/schema/core.ts:66) whose credentials it therefore pulls —
      // password_hash, email_verify_token, reset_token, telegram_bot_token,
      // totp_secret, totp_backup_codes. This handler is on proxy.ts's public
      // list and proves itself with a setup key, not a session, so the row it
      // returns was never one to hand back unprefixed. `return { u, t, token }`
      // below carries the row out of the transaction, so one spread would ship
      // the fresh hash. Three columns are read; tsc proves three is enough.
      const [u] = await tx.insert(users).values({
        email: emailLower,
        passwordHash,
        fullName: fullNameTrim,
        isSuperAdmin: true
      }).returning({ id: users.id, email: users.email, fullName: users.fullName });
      if (!u) throw new Error('Failed to create admin user');

      const slug = workspace_name.toLowerCase()
        .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40)
        + '-' + Date.now().toString(36);

      // 2. Look up the Enterprise plan UUID (it's often 'enterprise' by default)
      const enterprisePlan = await tx.query.plans.findFirst({
        // #2459: `plans` is 22 columns of pricing and limits; `planId` below is
        // the only thing ever read out of it.
        columns: { id: true },
        where: eq(plans.id, 'enterprise')
      });
      const planId = enterprisePlan?.id ?? 'enterprise';

      // 3. Create tenant
      // #2459: `tenants` is 34 columns — billing identifiers, `admin_notes` and
      // the tenant's `settings`/`metadata` — and this `RETURNING *` is the row
      // the response reads. It carries no credential today, which is exactly
      // why the projection belongs here: an unnamed `*` grows with the table.
      const [t] = await tx.insert(tenants).values({
        name: workspace_name.trim(),
        slug,
        ownerId: u.id,
        planId,
        status: 'active'
      }).returning({ id: tenants.id, name: tenants.name });
      if (!t) throw new Error('Failed to create tenant');

      // Roles, tenant_members, pipelines, deal_stages, tenant_modules and
      // onboarding_progress are all protected by tenant_isolation, which
      // cannot be satisfied before this tenant row exists — so the context is
      // set here, on this connection, for the remainder of the transaction.
      await setTenantContext(t.id, u.id, tx);

      // 4. Create admin role first for the new tenant
      // #2459: `roles` is 11 columns and the one that matters here is
      // `permissions` — the route just wrote `{ all: true }` into it, and the
      // only reader below wants the generated id to stamp tenant_members.
      const [adminRole] = await tx.insert(roles).values({
        tenantId: t.id,
        slug: 'admin',
        name: 'Administrator',
        permissions: { all: true },
        isSystem: true,
      }).onConflictDoUpdate({
        target: [roles.tenantId, roles.slug],
        set: { permissions: { all: true }, updatedAt: new Date() }
      }).returning({ id: roles.id });
      if (!adminRole) throw new Error('Failed to create admin role');

      const adminRoleId = adminRole.id;

      // 5. Create tenant member (the owner)
      await tx.insert(tenantMembers).values({
        tenantId: t.id,
        userId: u.id,
        roleSlug: 'admin',
        roleId: adminRoleId,
        status: 'active',
        joinedAt: new Date()
      }).onConflictDoUpdate({
        target: [tenantMembers.tenantId, tenantMembers.userId],
        set: {
          status: 'active',
          roleSlug: 'admin',
          roleId: adminRoleId,
          updatedAt: new Date(),
        }
      });

      // 6. Update user's last tenant ID
      await tx.update(users)
        .set({ lastTenantId: t.id })
        .where(eq(users.id, u.id));

      // 1. Create Default Sales Pipeline
      // #2459: `pipelines` is 9 columns; this insert writes three of them and
      // the only reader anywhere below is `pipeline.id`, for the deal stages.
      const [pipeline] = await tx.insert(pipelines).values({
        tenantId: t.id,
        name: 'Sales Pipeline',
        isDefault: true,
      }).returning({ id: pipelines.id });
      if (!pipeline) throw new Error('Failed to create pipeline');

      // 2. Create Default Stages
      const defaultStages = [
        { name: 'Lead', order: 1 },
        { name: 'Qualified', order: 2 },
        { name: 'Proposal', order: 3 },
        { name: 'Negotiation', order: 4 },
        { name: 'Won', order: 5 },
        { name: 'Lost', order: 6 },
      ];

      await tx.insert(dealStages).values(
        defaultStages.map(s => ({
          tenantId: t.id,
          pipelineId: pipeline.id,
          name: s.name,
          order: s.order,
        }))
      );

      // 3. Create Default Roles (beyond admin)
      await tx.insert(roles).values({
        tenantId: t.id,
        slug: 'sales_rep',
        name: 'Sales Representative',
        permissions: {
          'contacts.view': true, 'contacts.create': true, 'contacts.edit': true,
          'deals.view': true, 'deals.create': true, 'deals.edit': true,
          'tasks.view': true, 'tasks.create': true, 'tasks.manage': true,
        },
      }).onConflictDoNothing();

      // 4. Install plan-based default modules (covers core-crm, automation-basic, etc.)
      await installDefaultModules(t.id, planId, undefined, tx);

      // 7. Initialize onboarding progress
      await tx.insert(onboardingProgress).values({
        tenantId: t.id,
        userId: u.id,
        stepName: 'admin_created',
        isCompleted: true,
        completedAt: new Date(),
      }).onConflictDoNothing().catch((err: unknown) => logError({ error: err, context: 'setup/create-admin async side-effect' }));

      // 8. Create session
      const token = await createToken(u.id);
      const tokenHash = await hashToken(token);
      await tx.insert(sessions).values({
        userId: u.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });

      return { u, t, token };
    });

    const { u: user, t: tenant, token } = result;
    await setSessionCookie(token);

    return NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, full_name: user.fullName, is_super_admin: true },
      tenant: { id: tenant.id, name: tenant.name },
    }, { status: 201 });
 
 
  } catch (err) {
    void logError({ error: err, context: 'setup/create-admin' });
    return apiError(err);
  }
}
