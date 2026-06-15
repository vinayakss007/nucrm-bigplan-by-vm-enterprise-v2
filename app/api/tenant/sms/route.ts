import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { smsMessages } from '@/drizzle/schema/sms';
import { eq, and, desc, sql } from 'drizzle-orm';
import { sendSMS, sendTemplateSMS } from '@/lib/sms';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

const sendSMSSchema = z.object({
  to: z.string().min(1),
  body: z.string().min(1).optional(),
  templateId: z.string().uuid().optional(),
  variables: z.record(z.string(), z.string()).optional(),
  contactId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'whatsapp-bot');
    if (moduleGate) return moduleGate;

    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
    const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0'));
    const status = searchParams.get('status');

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filters: any[] = [eq(smsMessages.tenantId, ctx.tenantId)];
    if (status) {
      filters.push(eq(smsMessages.status, status));
    }

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(smsMessages)
      .where(and(...filters));

    const data = await db.select()
      .from(smsMessages)
      .where(and(...filters))
      .orderBy(desc(smsMessages.createdAt))
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

    const moduleGate = await requireModule(ctx.tenantId, 'whatsapp-bot');
    if (moduleGate) return moduleGate;

    const body = await req.json();
    const validated = validateBody(sendSMSSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // Template-based or direct SMS
    if (v.templateId) {
      const result = await sendTemplateSMS({
        to: v.to,
        templateId: v.templateId,
        variables: v.variables || {},
        tenantId: ctx.tenantId,
        contactId: v.contactId,
      });
      return NextResponse.json({ data: result }, { status: result.success ? 201 : 400 });
    }

    if (!v.body) {
      return NextResponse.json({ error: 'Either body or templateId is required' }, { status: 400 });
    }

    const result = await sendSMS({
      to: v.to,
      body: v.body,
      tenantId: ctx.tenantId,
      contactId: v.contactId,
    });

    return NextResponse.json({ data: result }, { status: result.success ? 201 : 400 });
  } catch (err) {
    return apiError(err);
  }
}
