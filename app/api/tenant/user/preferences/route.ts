import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const [user] = await db
      .select({ metadata: users.metadata })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const prefs = (user.metadata as Record<string, unknown>)?.sidebar ?? {};
    return NextResponse.json({ data: prefs });
  } catch (err) {
    console.error('[user prefs GET]', err);
    return NextResponse.json({ error: 'Failed to load preferences' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const body = await req.json();
    const { pinned, sections } = body;

    const [user] = await db
      .select({ metadata: users.metadata })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const metadata = (user.metadata as Record<string, unknown>) || {};
    const currentSidebar = (metadata.sidebar as Record<string, unknown>) || {};

    if (pinned !== undefined) currentSidebar.pinned = pinned;
    if (sections !== undefined) currentSidebar.sections = sections;

    metadata.sidebar = currentSidebar;

    await db
      .update(users)
      .set({ metadata: metadata as typeof users.$inferInsert.metadata })
      .where(eq(users.id, ctx.userId));

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update_sidebar_prefs',
      entityType: 'user',
      entityId: ctx.userId,
    });

    return NextResponse.json({ ok: true, data: currentSidebar });
  } catch (err) {
    console.error('[user prefs PUT]', err);
    return NextResponse.json({ error: 'Failed to save preferences' }, { status: 500 });
  }
}
