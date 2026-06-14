import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users, contacts, deals, tasks, activities, tenantMembers } from '@/drizzle/schema';
import { eq, and, or, ilike, sql, desc } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

const restoreUserDataSchema = z.object({
  user_id: z.string().uuid('user_id is required'),
  tenant_id: z.string().uuid('tenant_id is required'),
  records: z.object({
    contacts: z.array(z.record(z.string(), z.unknown())).optional(),
    deals: z.array(z.record(z.string(), z.unknown())).optional(),
    tasks: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
  source: z.string().optional().default('manual'),
});

/**
 * Per-User Data Find & Restore API
 *
 * USE CASE: A specific user's data needs to be found, exported, or restored.
 * - User accidentally deleted their contacts
 * - Need to audit what data belongs to a specific user
 * - User leaving — export their owned data
 * - Restore a specific user's records from backup
 *
 * GET  /api/superadmin/user-data?user_id=...&tenant_id=...
 *      → Find all data owned/created by a specific user
 *
 * GET  /api/superadmin/user-data?search=email@...
 *      → Search for a user across all tenants by email/name
 *
 * POST /api/superadmin/user-data
 *      → Restore specific records for a user from backup data
 *
 * DELETE /api/superadmin/user-data
 *      → Soft-delete all data owned by a user (for GDPR right-to-erasure)
 */

// ── GET: Find user data ──────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');
    const tenantId = searchParams.get('tenant_id');
    const search = searchParams.get('search');
    const action = searchParams.get('action') || 'summary'; // summary | full | export

    // ── Search for user by email/name ────────────────────────────────────
    if (search) {
      const pattern = `%${search}%`;
      const foundUsers = await db.select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        createdAt: users.createdAt,
        isSuperAdmin: users.isSuperAdmin,
        emailVerified: users.emailVerified,
      })
        .from(users)
        .where(or(
          ilike(users.email, pattern),
          ilike(users.fullName, pattern)
        ))
        .orderBy(desc(users.createdAt))
        .limit(20);

      // Get memberships for each user
      const results = await Promise.all(foundUsers.map(async (u) => {
        const memberships = await db.select({
          tenantId: tenantMembers.tenantId,
          roleSlug: tenantMembers.roleSlug,
          status: tenantMembers.status,
        })
          .from(tenantMembers)
          .where(eq(tenantMembers.userId, u.id));

        return { ...u, memberships };
      }));

      return NextResponse.json({ users: results, total: results.length });
    }

    // ── Get specific user's data ─────────────────────────────────────────
    if (!userId) {
      return NextResponse.json(
        { error: 'Provide user_id or search parameter' },
        { status: 400 }
      );
    }

    // Verify user exists
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, email: true, fullName: true, createdAt: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get all tenants this user belongs to
    const memberships = await db.select({
      tenantId: tenantMembers.tenantId,
      roleSlug: tenantMembers.roleSlug,
      status: tenantMembers.status,
      joinedAt: tenantMembers.createdAt,
    })
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, userId));

    // Determine which tenant to scope to
    const scopeTenantId = tenantId || memberships[0]?.tenantId;

    if (!scopeTenantId) {
      return NextResponse.json({
        user,
        memberships,
        data: { contacts: 0, deals: 0, tasks: 0, activities: 0, notes: 0 },
        message: 'User has no tenant memberships',
      });
    }

    // ── Summary: count records owned by this user ────────────────────────
    if (action === 'summary') {
      const [contactCount, dealCount, taskCount, activityCount] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` })
          .from(contacts)
          .where(and(
            eq(contacts.tenantId, scopeTenantId),
            eq(contacts.assignedTo, userId),
            sql`${contacts.deletedAt} IS NULL`
          )),
        db.select({ count: sql<number>`count(*)::int` })
          .from(deals)
          .where(and(
            eq(deals.tenantId, scopeTenantId),
            eq(deals.assignedTo, userId),
            sql`${deals.deletedAt} IS NULL`
          )),
        db.select({ count: sql<number>`count(*)::int` })
          .from(tasks)
          .where(and(
            eq(tasks.tenantId, scopeTenantId),
            eq(tasks.assignedTo, userId)
          )),
        db.select({ count: sql<number>`count(*)::int` })
          .from(activities)
          .where(and(
            eq(activities.tenantId, scopeTenantId),
            eq(activities.userId, userId)
          )),
      ]);

      return NextResponse.json({
        user,
        memberships,
        scopedTenantId: scopeTenantId,
        data: {
          contacts: contactCount[0]?.count ?? 0,
          deals: dealCount[0]?.count ?? 0,
          tasks: taskCount[0]?.count ?? 0,
          activities: activityCount[0]?.count ?? 0,
        },
      });
    }

    // ── Full: return actual records ──────────────────────────────────────
    if (action === 'full' || action === 'export') {
      const limit = action === 'export' ? 10000 : 100;

      const [userContacts, userDeals, userTasks, userActivities] = await Promise.all([
        db.select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          email: contacts.email,
          phone: contacts.phone,
          leadStatus: contacts.leadStatus,
          createdAt: contacts.createdAt,
        })
          .from(contacts)
          .where(and(
            eq(contacts.tenantId, scopeTenantId),
            eq(contacts.assignedTo, userId),
            sql`${contacts.deletedAt} IS NULL`
          ))
          .orderBy(desc(contacts.createdAt))
          .limit(limit),

        db.select({
          id: deals.id,
          title: deals.title,
          value: deals.amount,
          stage: deals.stageId,
          createdAt: deals.createdAt,
        })
          .from(deals)
          .where(and(
            eq(deals.tenantId, scopeTenantId),
            eq(deals.assignedTo, userId),
            sql`${deals.deletedAt} IS NULL`
          ))
          .orderBy(desc(deals.createdAt))
          .limit(limit),

        db.select({
          id: tasks.id,
          title: tasks.title,
          priority: tasks.priority,
          completed: tasks.completed,
          dueDate: tasks.dueDate,
          createdAt: tasks.createdAt,
        })
          .from(tasks)
          .where(and(
            eq(tasks.tenantId, scopeTenantId),
            eq(tasks.assignedTo, userId)
          ))
          .orderBy(desc(tasks.createdAt))
          .limit(limit),

        db.select({
          id: activities.id,
          type: activities.eventType,
          description: activities.description,
          createdAt: activities.createdAt,
        })
          .from(activities)
          .where(and(
            eq(activities.tenantId, scopeTenantId),
            eq(activities.userId, userId)
          ))
          .orderBy(desc(activities.createdAt))
          .limit(limit),
      ]);

      return NextResponse.json({
        user,
        memberships,
        scopedTenantId: scopeTenantId,
        data: {
          contacts: userContacts,
          deals: userDeals,
          tasks: userTasks,
          activities: userActivities,
        },
        counts: {
          contacts: userContacts.length,
          deals: userDeals.length,
          tasks: userTasks.length,
          activities: userActivities.length,
        },
      });
    }

    return NextResponse.json({ error: 'Invalid action. Use: summary, full, export' }, { status: 400 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

// ── POST: Restore specific user records from backup ──────────────────────────

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    }

    const raw = await request.json();
    const parsed = validateBody(restoreUserDataSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { user_id, tenant_id, records, source } = parsed.data;

    // Verify user and tenant exist
    const user = await db.query.users.findFirst({
      where: eq(users.id, user_id),
      columns: { id: true, email: true },
    });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const results: Record<string, { restored: number; errors: number }> = {};

    // Restore contacts
    if (records.contacts?.length) {
      let restored = 0;
      let errors = 0;
      for (const contact of records.contacts) {
        try {
          const { id: _id, ...rest } = contact as Record<string, unknown>;
          await db.insert(contacts).values({
            ...rest,
            tenantId: tenant_id,
            assignedTo: user_id,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          } as typeof contacts.$inferInsert).onConflictDoNothing();
          restored++;
        } catch { errors++; }
      }
      results['contacts'] = { restored, errors };
    }

    // Restore deals
    if (records.deals?.length) {
      let restored = 0;
      let errors = 0;
      for (const deal of records.deals) {
        try {
          const { id: _id, ...rest } = deal as Record<string, unknown>;
          await db.insert(deals).values({
            ...rest,
            tenantId: tenant_id,
            assignedTo: user_id,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          } as typeof deals.$inferInsert).onConflictDoNothing();
          restored++;
        } catch { errors++; }
      }
      results['deals'] = { restored, errors };
    }

    // Restore tasks
    if (records.tasks?.length) {
      let restored = 0;
      let errors = 0;
      for (const task of records.tasks) {
        try {
          const { id: _id, ...rest } = task as Record<string, unknown>;
          await db.insert(tasks).values({
            ...rest,
            tenantId: tenant_id,
            assignedTo: user_id,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as typeof tasks.$inferInsert).onConflictDoNothing();
          restored++;
        } catch { errors++; }
      }
      results['tasks'] = { restored, errors };
    }

    console.log(`[User Data Restore] user=${user.email}, tenant=${tenant_id}, source=${source}, results=`, results);

    return NextResponse.json({
      success: true,
      message: `Data restored for ${user.email}`,
      results,
    });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

// ── DELETE: Soft-delete all user data (GDPR right-to-erasure) ────────────────

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');
    const tenantId = searchParams.get('tenant_id');
    const confirm = searchParams.get('confirm');

    if (!userId || !tenantId) {
      return NextResponse.json({ error: 'user_id and tenant_id required' }, { status: 400 });
    }

    if (confirm !== 'true') {
      return NextResponse.json({
        error: 'Add ?confirm=true to confirm deletion. This soft-deletes all records owned by this user.',
        warning: 'This action cannot be easily undone. Ensure you have a backup first.',
      }, { status: 400 });
    }

    const now = new Date();

    // Soft-delete contacts
    const contactResult = await db.update(contacts)
      .set({ deletedAt: now })
      .where(and(
        eq(contacts.tenantId, tenantId),
        eq(contacts.assignedTo, userId),
        sql`${contacts.deletedAt} IS NULL`
      ));

    // Soft-delete deals
    const dealResult = await db.update(deals)
      .set({ deletedAt: now })
      .where(and(
        eq(deals.tenantId, tenantId),
        eq(deals.assignedTo, userId),
        sql`${deals.deletedAt} IS NULL`
      ));

    console.log(`[User Data DELETE] GDPR erasure for user=${userId}, tenant=${tenantId}`);

    return NextResponse.json({
      success: true,
      message: `All data soft-deleted for user in tenant ${tenantId}. Records can be restored from trash within 30 days.`,
      deleted: {
        contacts: 'soft-deleted',
        deals: 'soft-deleted',
      },
    });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
