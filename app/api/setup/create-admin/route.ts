import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { users, tenants, tenantMembers, plans, roles, onboardingProgress, sessions, pipelines, dealStages } from '@/drizzle/schema';
import { eq, count, sql, and } from 'drizzle-orm';
import { hashPassword, createToken, hashToken, setSessionCookie, validatePassword } from '@/lib/auth/session';
import { installDefaultModules } from '@/lib/modules/auto-install';
import { logError } from '@/lib/errors-server';

export async function POST(request: NextRequest) {
  try {
    // Parse body once
    const body = await request.json().catch(e => { console.error('[json] parse error:', e); return {}; });
    const { full_name, email, password, workspace_name, setup_key } = body;

    // Only works if zero super admin users exist
    const [existing] = await db.select({ 
      count: count() 
    })
    .from(users)
    .where(eq(users.isSuperAdmin, true));

    if ((existing?.count ?? 0) > 0) {
      return NextResponse.json({ error: 'Platform Super Admin already exists. Only one is allowed.' }, { status: 403 });
    }

    // Validate setup key in production
    if (process.env.NODE_ENV === 'production' && process.env.SETUP_KEY) {
      if (setup_key !== process.env.SETUP_KEY) {
        return NextResponse.json({ error: 'Invalid setup key' }, { status: 401 });
      }
    }

    if (!full_name?.trim() || !email?.trim() || !password || !workspace_name?.trim()) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }
    const passwordError = validatePassword(password);
    if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

    const passwordHash = await hashPassword(password);
    const emailLower = email.trim().toLowerCase();
    const fullNameTrim = full_name.trim();

    const result = await db.transaction(async (tx) => {
      // 1. Create super admin user
      const [u] = await tx.insert(users).values({
        email: emailLower,
        passwordHash,
        fullName: fullNameTrim,
        isSuperAdmin: true
      }).returning();
      if (!u) throw new Error('Failed to create admin user');

      const slug = workspace_name.toLowerCase()
        .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40)
        + '-' + Date.now().toString(36);

      // 2. Look up the Enterprise plan UUID (it's often 'enterprise' by default)
      const enterprisePlan = await tx.query.plans.findFirst({
        where: eq(plans.id, 'enterprise')
      });
      const planId = enterprisePlan?.id ?? 'enterprise';

      // 3. Create tenant
      const [t] = await tx.insert(tenants).values({
        name: workspace_name.trim(),
        slug,
        ownerId: u.id,
        planId,
        status: 'active'
      }).returning();
      if (!t) throw new Error('Failed to create tenant');
      
      // 4. Create admin role first for the new tenant
      const [adminRole] = await tx.insert(roles).values({
        tenantId: t.id,
        slug: 'admin',
        name: 'Administrator',
        permissions: { all: true },
        isSystem: true,
      }).onConflictDoUpdate({
        target: [roles.tenantId, roles.slug],
        set: { permissions: { all: true } }
      }).returning();
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
          roleId: adminRoleId
        }
      });

      // 6. Update user's last tenant ID
      await tx.update(users)
        .set({ lastTenantId: t.id })
        .where(eq(users.id, u.id));

      // 1. Create Default Sales Pipeline
      const [pipeline] = await tx.insert(pipelines).values({
        tenantId: t.id,
        name: 'Sales Pipeline',
        isDefault: true,
      }).returning();
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

      for (const s of defaultStages) {
        await tx.insert(dealStages).values({
          pipelineId: pipeline.id,
          name: s.name,
          order: s.order,
        });
      }

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
      await installDefaultModules(t.id, planId);

      // 7. Initialize onboarding progress
      await tx.insert(onboardingProgress).values({
        tenantId: t.id,
        userId: u.id,
        stepName: 'admin_created',
        isCompleted: true,
        completedAt: new Date(),
      }).onConflictDoNothing().catch((err) => logError({ error: err, context: "async-catch:[context]" }));

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
  } catch (err: any) {
    console.error('[setup/create-admin]', err);
    return apiError(err);
  }
}
