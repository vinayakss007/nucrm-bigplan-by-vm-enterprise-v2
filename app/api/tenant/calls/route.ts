import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { callLogs } from '@/drizzle/schema';
import { contacts, companies, users } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

const createCallSchema = z.object({
  contact_id: z.string().uuid('contact_id must be a valid UUID'),
  company_id: z.string().uuid().optional().nullable(),
  deal_id: z.string().uuid().optional().nullable(),
  direction: z.enum(['inbound', 'outbound']).optional().default('outbound'),
  duration: z.number().int().min(0).optional().default(0),
  notes: z.string().max(5000).optional().nullable(),
  phone_number: z.string().max(30).optional().nullable(),
  recorded_url: z.string().max(500).optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
});

/**
 * POST /api/tenant/calls
 * Log a call (inbound/outbound) with duration, notes, linked contact
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.edit');
    if (deny) return deny;

    const raw = await req.json();
    const parsed = validateBody(createCallSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { contact_id, company_id, deal_id, direction, duration, notes, phone_number, recorded_url, assigned_to } = parsed.data;

    // Verify contact belongs to tenant
    const [contact] = await db.select({ id: contacts.id })
      .from(contacts)
      .where(and(
        eq(contacts.id, contact_id),
        eq(contacts.tenantId, ctx.tenantId),
        isNull(contacts.deletedAt)
      ))
      .limit(1);
      
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const [call] = await db.insert(callLogs).values({
      tenantId: ctx.tenantId,
      contactId: contact_id,
      companyId: company_id ?? null,
      dealId: deal_id ?? null,
      userId: ctx.userId,
      direction,
      duration,
      notes: notes ?? null,
      phoneNumber: phone_number ?? null,
      recordedUrl: recorded_url ?? null,
      assignedTo: assigned_to ?? null,
    }).returning();

    return NextResponse.json({ data: call }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

/**
 * GET /api/tenant/calls
 * List call logs with optional contact filter
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.view_all')) {
      // Temporarily allow if they can at least view their own, but check later in filters
    }

    const { searchParams } = new URL(req.url);
    const contactId = searchParams.get('contact_id');
    const dealId = searchParams.get('deal_id');
    const limit = Math.min(100, parseInt(searchParams.get('limit') || '50'));
    const offset = parseInt(searchParams.get('offset') || '0');

    const filters = [
      eq(callLogs.tenantId, ctx.tenantId)
    ];

    if (contactId) {
      filters.push(eq(callLogs.contactId, contactId));
    }

    if (dealId) {
      filters.push(eq(callLogs.dealId, dealId));
    }

    // Only admin can view all calls, others see only their own
    if (!can(ctx, 'contacts.view_all')) {
      filters.push(eq(callLogs.userId, ctx.userId));
    }

    const calls = await db.select({
      id: callLogs.id,
      tenantId: callLogs.tenantId,
      contactId: callLogs.contactId,
      companyId: callLogs.companyId,
      dealId: callLogs.dealId,
      userId: callLogs.userId,
      direction: callLogs.direction,
      duration: callLogs.duration,
      notes: callLogs.notes,
      phoneNumber: callLogs.phoneNumber,
      recordedUrl: callLogs.recordedUrl,
      assignedTo: callLogs.assignedTo,
      createdAt: callLogs.createdAt,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      companyName: companies.name,
      userName: users.fullName,
    })
    .from(callLogs)
    .leftJoin(contacts, eq(contacts.id, callLogs.contactId))
    .leftJoin(companies, eq(companies.id, callLogs.companyId))
    .leftJoin(users, eq(users.id, callLogs.userId))
    .where(and(...filters))
    .orderBy(desc(callLogs.createdAt))
    .limit(limit)
    .offset(offset);

    return NextResponse.json({ data: calls });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
