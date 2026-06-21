import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, emailTemplates } from '@/drizzle/schema';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import { sendEmail, renderTemplate } from '@/lib/email/service';
import { logAudit } from '@/lib/audit';

const MAX_EMAILS = 50;

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const permErr = requirePerm(ctx, 'contacts.edit');
    if (permErr) return permErr;

    const { entity_type, entity_ids, template_id } = await req.json();

    if (!entity_ids?.length || entity_ids.length > MAX_EMAILS) {
      return NextResponse.json({ error: `Max ${MAX_EMAILS} emails per batch` }, { status: 400 });
    }

    const [template] = await db.select().from(emailTemplates)
      .where(and(eq(emailTemplates.id, template_id), eq(emailTemplates.tenantId, ctx.tenantId)))
      .limit(1);
    if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

    const ents = await db.select({
      id: contacts.id,
      email: contacts.email,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
    })
      .from(contacts)
      .where(and(inArray(contacts.id, entity_ids), eq(contacts.tenantId, ctx.tenantId), isNull(contacts.deletedAt)));

    let sent = 0, failed = 0;
    const errors: string[] = [];

    for (const ent of ents) {
      if (!ent.email) { failed++; errors.push(`No email for ${ent.id}`); continue; }

      const vars: Record<string, string> = {
        first_name: ent.firstName || '',
        last_name: ent.lastName || '',
        email: ent.email,
      };

      const subject = renderTemplate(template.subject, vars);
      const html = renderTemplate(template.bodyHtml, vars);

      const result = await sendEmail({ to: ent.email, subject, html });
      if (result.success) sent++; else { failed++; errors.push(`${ent.email}: ${result.error}`); }
    }

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'bulk_email',
      entityType: entity_type,
      newData: { sent, failed, template_id },
    });

    return NextResponse.json({ ok: true, sent, failed, errors: errors.slice(0, 10) });
  } catch (err) {
    console.error('[email bulk]', err);
    return NextResponse.json({ error: 'Failed to send emails' }, { status: 500 });
  }
}
