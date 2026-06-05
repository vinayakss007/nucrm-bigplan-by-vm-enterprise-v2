import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { chatSessions } from '@/drizzle/schema/chat';
import { eq, and, desc, ne, sql } from 'drizzle-orm';
import { createChatSession } from '@/lib/chat';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

const createSessionSchema = z.object({
  visitorId: z.string().min(1),
  visitorName: z.string().optional(),
  visitorEmail: z.string().email().optional(),
  channel: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'service-helpdesk');
    if (moduleGate) return moduleGate;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
    const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0'));

    const filters: any[] = [eq(chatSessions.tenantId, ctx.tenantId)];
    if (status) {
      filters.push(eq(chatSessions.status, status));
    } else {
      // By default, get non-closed sessions
      filters.push(ne(chatSessions.status, 'closed'));
    }

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(chatSessions)
      .where(and(...filters));

    const data = await db.select()
      .from(chatSessions)
      .where(and(...filters))
      .orderBy(desc(chatSessions.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({ data, total: countResult?.count ?? 0, limit, offset });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'service-helpdesk');
    if (moduleGate) return moduleGate;

    const body = await req.json();
    const validated = validateBody(createSessionSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const session = await createChatSession({
      visitorId: v.visitorId,
      tenantId: ctx.tenantId,
      visitorName: v.visitorName,
      visitorEmail: v.visitorEmail,
      channel: v.channel,
    });

    return NextResponse.json({ data: session }, { status: 201 });
  } catch (err) {
    return apiError(err);
  }
}
