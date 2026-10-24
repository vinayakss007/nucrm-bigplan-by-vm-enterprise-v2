/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Send an invoice via email
 * POST /api/tenant/invoices/[id]/send
 * body: { to_email?, message? }
 *
 * Sends the invoice PDF link to the customer via email.
 *
 * #2227: status:'sent' + sentAt are persisted only after the email is
 * delivered. On delivery failure the invoice keeps its old status and the
 * route answers 502 so the UI can retry honestly.
 *
 * #3168: on success the status write is a guarded claim — `draft → sent` and
 * nothing else, scoped to the tenant — because `invoices.status` belongs to the
 * payment ledger. A send that loses that claim emails the customer, records the
 * activity, and reports the status the ledger actually holds.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireCsrf } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { invoices, contacts, activities } from '@/drizzle/schema';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { INVOICE_SENDABLE_FROM } from '@/lib/billing/payments';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { logAudit } from '@/lib/audit';
import { sendEmail } from '@/lib/email/service';
import { sanitizeHTMLServer } from '@/lib/sanitize';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

export const POST = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const csrf = requireCsrf(req); // #1835: in-handler CSRF defense-in-depth (after auth)
    if (csrf) return csrf;

    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Invoice ID required' }, { status: 400 });

    const invoice = await db.query.invoices.findFirst({
      where: and(eq(invoices.id, id), eq(invoices.tenantId, ctx.tenantId), isNull(invoices.deletedAt)),
    });
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    let body: { to_email?: string; message?: string };
    try { body = await readJsonBody(req) as { to_email?: string; message?: string }; } catch { body = {}; }

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

    // #2227: the email is attempted FIRST and the status write happens only
    // after a successful delivery. The old order (commit status:'sent' in a tx,
    // then try SMTP, console.warn on failure, still answer ok:true) meant a
    // provider outage permanently marked the invoice sent although the customer
    // never received anything, and downstream logic treats 'sent' as "issued".
    // Lesson from #2222 also applies in reverse: SMTP must never run INSIDE the
    // db.transaction — network waits would hold a Postgres transaction open.
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

    // Delivery failed → keep the invoice in its current status and answer a
    // non-ok 502 (same honest-failure shape as email/test-send) so the UI can
    // surface the error and the user can retry.
    if (!emailResult?.success) {
      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'invoice_send_failed',
        entityType: 'invoice',
        entityId: id,
        newData: { to_email: toEmail, email_result: emailResult },
      });
      return NextResponse.json(
        {
          error: 'Email delivery failed — the invoice was NOT marked as sent. Please retry.',
          ok: false,
          status: invoice.status,
          email: emailResult,
        },
        { status: 502 },
      );
    }

    // Delivery succeeded — persist status:'sent' + activity row atomically.
    // If this write fails the handler 500s via the outer catch: the customer
    // has the email, and a retry may duplicate it — the honest-failure
    // direction we prefer (#2227).
    //
    // #3168: this used to be `UPDATE invoices SET status='sent' WHERE id=$1`,
    // unguarded and unscoped. Two things were wrong with it. The status is owned
    // by the payment ledger, so re-emailing a paid invoice demoted it below its
    // own `amount_paid`, and re-emailing a cancelled or void one reopened a
    // document the ledger refuses to touch. And tenancy rested entirely on the
    // pre-read above, an SMTP round-trip earlier — a window, not a guard. The
    // write now claims the from-set `INVOICE_SENDABLE_FROM` and its tenant in the
    // WHERE, which Postgres re-evaluates under the row lock; zero rows back means
    // the invoice moved while this handler was talking to the provider, so the
    // committed status is re-read and reported instead of a status that was never
    // written. The email did go out either way, so the timeline still records it.
    const status = await db.transaction(async (tx): Promise<string> => {
      const now = new Date();
      const [claimed] = await tx
        .update(invoices)
        .set({ status: 'sent', sentAt: now, updatedAt: now })
        .where(and(
          eq(invoices.id, id),
          eq(invoices.tenantId, ctx.tenantId),
          inArray(invoices.status, INVOICE_SENDABLE_FROM),
        ))
        .returning({ id: invoices.id });

      let committed = 'sent';
      if (!claimed) {
        const [fresh] = await tx
          .select({ status: invoices.status })
          .from(invoices)
          .where(and(eq(invoices.id, id), eq(invoices.tenantId, ctx.tenantId)))
          .limit(1);
        committed = fresh?.status ?? String(invoice.status);
      }

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
            // #3168: distinguishes "this send issued the document" from "this
            // send re-emailed an invoice the ledger had already moved on".
            status_after_send: committed,
          },
        });
      }
      return committed;
    });

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'invoice_sent',
      entityType: 'invoice',
      entityId: id,
      newData: { to_email: toEmail, email_result: emailResult, status },
    });

    return NextResponse.json({ ok: true, status, to_email: toEmail, email: emailResult });
  } catch (err) {
    await logError({ error: err, context: 'tenant/invoices/[id]/send POST', requestMethod: 'POST' });
    return apiError(err);
  }
});
