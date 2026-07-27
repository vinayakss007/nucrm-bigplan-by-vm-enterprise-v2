/**
 * Send an invoice via email
 * POST /api/tenant/invoices/[id]/send
 * body: { to_email?, message? }
 *
 * Sends the invoice PDF link to the customer via email.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { invoices, contacts, activities } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';
import { sendEmail } from '@/lib/email/service';
import { sanitizeHTMLServer } from '@/lib/sanitize';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Invoice ID required' }, { status: 400 });

    const invoice = await db.query.invoices.findFirst({
      where: and(eq(invoices.id, id), eq(invoices.tenantId, ctx.tenantId), isNull(invoices.deletedAt)),
    });
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    let body: { to_email?: string; message?: string };
    try { body = await req.json() as { to_email?: string; message?: string }; } catch { body = {}; }

    // Resolve email
    let toEmail = body.to_email?.trim() || null;
    let contactName = 'there';
    if (invoice.contactId) {
      const contact = await db.query.contacts.findFirst({
        where: eq(contacts.id, invoice.contactId),
        columns: { firstName: true, lastName: true, email: true },
      });
      if (!toEmail && contact?.email) toEmail = contact.email;
      if (contact?.firstName) contactName = contact.firstName;
    }
    if (!toEmail) {
      return NextResponse.json({ error: 'Email required (provide to_email or attach a contact)' }, { status: 400 });
    }

    // Update status to sent + activity row atomically
    await db.transaction(async (tx) => {
      await tx.update(invoices).set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() }).where(eq(invoices.id, id));

      if (invoice.contactId) {
        await tx.insert(activities).values({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          entityType: 'invoice',
          entityId: id,
          contactId: invoice.contactId,
          eventType: 'invoice_sent',
          description: `Invoice "${invoice.title}" sent to ${toEmail}`,
          metadata: {
            invoice_id: id,
            invoice_number: invoice.invoiceNumber,
            total_amount: invoice.totalAmount,
            to_email: toEmail,
          },
        });
      }
    });

    // Send email
    const pdfUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/tenant/invoices/${id}/pdf`;
    const safeContactName = sanitizeHTMLServer(contactName || '');
    const safeInvoiceTitle = sanitizeHTMLServer(invoice.title || '');
    const safeInvoiceNumber = sanitizeHTMLServer(invoice.invoiceNumber || '');
    let emailResult: { success: boolean; provider?: string; error?: string } | null = null;
    try {
      emailResult = await sendEmail({
        to: toEmail,
        subject: `Invoice: ${invoice.title || invoice.invoiceNumber}`,
        html: `
          <p>Hi ${safeContactName},</p>
          <p>Please find your invoice <strong>${safeInvoiceNumber || safeInvoiceTitle}</strong> for <strong>$${Number(invoice.totalAmount).toFixed(2)}</strong>.</p>
          ${body.message ? `<p>${sanitizeHTMLServer(body.message)}</p>` : ''}
          <p><a href="${pdfUrl}" style="display:inline-block;padding:10px 18px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">View Invoice</a></p>
          ${invoice.dueDate ? `<p style="color:#6b7280;font-size:13px;margin-top:16px">Due date: ${new Date(invoice.dueDate).toLocaleDateString()}</p>` : ''}
          <p style="color:#6b7280;font-size:13px;margin-top:24px">If the button doesn't work, paste this link into your browser:<br/>${pdfUrl}</p>
        `,
        text: `Invoice ${invoice.invoiceNumber || invoice.title} for $${Number(invoice.totalAmount).toFixed(2)}: ${pdfUrl}`,
      });
    } catch (err) {
      console.warn('[invoices/send] email send threw:', (err as Error).message);
      emailResult = { success: false, error: (err as Error).message };
    }

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'invoice_sent',
      entityType: 'invoice',
      entityId: id,
      newData: { to_email: toEmail, email_result: emailResult },
    });

    return NextResponse.json({ ok: true, status: 'sent', to_email: toEmail, email: emailResult });
  } catch (err) {
    console.error('[invoices/send POST]', err);
    return apiError(err);
  }
}
