import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { meetings, contacts } from '@/drizzle/schema';
import { eq, and, isNull, gte, lte, sql, asc, desc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const status = searchParams.get('status');
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') ?? '100')));
    const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0'));

    const filters = [
      eq(meetings.tenantId, ctx.tenantId),
      isNull(meetings.deletedAt)
    ];

    if (start) {
      filters.push(gte(meetings.startTime, new Date(start)));
    }
    if (end) {
      filters.push(lte(meetings.startTime, new Date(end + 'T23:59:59')));
    }
    if (status) {
      filters.push(eq(meetings.status, status));
    }

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(meetings)
      .where(and(...filters));

    const data = await db.select({
      id: meetings.id,
      tenantId: meetings.tenantId,
      userId: meetings.userId,
      contactId: meetings.contactId,
      dealId: meetings.dealId,
      title: meetings.title,
      description: meetings.description,
      startTime: meetings.startTime,
      endTime: meetings.endTime,
      location: meetings.location,
      meetingUrl: meetings.meetingUrl,
      status: meetings.status,
      createdAt: meetings.createdAt,
      updatedAt: meetings.updatedAt,
      contact_name: sql<string>`COALESCE(${contacts.firstName} || ' ' || ${contacts.lastName}, '')`
    })
    .from(meetings)
    .leftJoin(contacts, eq(contacts.id, meetings.contactId))
    .where(and(...filters))
    .orderBy(asc(meetings.startTime))
    .limit(limit)
    .offset(offset);

    return NextResponse.json({
      data,
      total: countResult?.count ?? 0,
      limit,
      offset,
      hasMore: offset + data.length < (countResult?.count ?? 0),
    });
  } catch (err: any) { 
    return apiError(err); 
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const body = await request.json();
    if (!body.title || !body.start_time) {
      return NextResponse.json({ error: 'title and start_time required' }, { status: 400 });
    }
    
    const endTime = body.end_time || new Date(new Date(body.start_time).getTime() + 3600000).toISOString();
    
    const [row] = await db.insert(meetings).values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      contactId: body.contact_id || null,
      dealId: body.deal_id || null,
      title: body.title,
      description: body.description || null,
      startTime: new Date(body.start_time),
      endTime: new Date(endTime),
      location: body.location || null,
      meetingUrl: body.meeting_url || null,
      status: 'scheduled',
    }).returning();

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) { 
    return apiError(err); 
  }
}
