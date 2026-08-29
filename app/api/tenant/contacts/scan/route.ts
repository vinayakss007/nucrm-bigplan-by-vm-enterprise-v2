/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { checkRateLimit } from '@/lib/rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { apiError } from '@/lib/api-error';
import { db } from '@/drizzle/db';
import { contacts, activities, tenants } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { z } from 'zod';
import {
  parseBusinessCard,
  parseVCard,
  normalizePhone,
  normalizeEmail,
  toContactPayload,
  detectDuplicate,
} from '@/lib/field-sales/card-scanner';
import { logError } from '@/lib/errors-server';
import { withApiRoute } from '@/lib/api/with-api-route';

const scanBodySchema = z.object({
  text: z.string().min(1, 'Text is required').max(10000, 'Text too long'),
  type: z.enum(['ocr', 'vcard']),
  source: z.enum(['business_card', 'qr_code']).optional(),
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const limited = await checkRateLimit(request, {
      action: 'contacts_scan',
      max: 50,
      windowMinutes: 60,
    });
    if (limited) return limited;

    const deny = requirePerm(ctx, 'contacts.create');
    if (deny) return deny;

    const body = await readJsonBody(request);

    // Validate input
    const parsed = scanBodySchema.safeParse(body);
    if (!parsed.success) {
      const errors = parsed.error.issues.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return NextResponse.json(
        { error: 'Validation failed', details: errors },
        { status: 400 },
      );
    }

    const { text, type, source } = parsed.data;

    // Parse the scanned text
    const scannedCard = type === 'vcard' ? parseVCard(text) : parseBusinessCard(text);

    // Normalize extracted data
    const normalizedEmail = scannedCard.email
      ? normalizeEmail(scannedCard.email)
      : undefined;
    const normalizedPhone = scannedCard.phone
      ? normalizePhone(scannedCard.phone)
      : undefined;

    // Check for duplicates
    const duplicateResult = await detectDuplicate(
      normalizedEmail,
      normalizedPhone,
      ctx.tenantId,
    );

    if (duplicateResult.isDuplicate) {
      return NextResponse.json(
        {
          contact: null,
          isDuplicate: true,
          duplicateId: duplicateResult.duplicateId,
          parsed: scannedCard,
        },
        { status: 409 },
      );
    }

    // Convert to contact payload and create
    const payload = toContactPayload(scannedCard, ctx.tenantId, ctx.userId);
    const leadSource = source === 'qr_code' ? 'qr_code_scan' : 'business_card_scan';

    const contact = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(contacts)
        .values({
          ...payload,
          leadSource,
          leadStatus: 'new',
          tags: [],
          customFields: {},
        })
        .returning();

      if (!c) throw new Error('Failed to create contact from scan');

      // Activity log
      await tx
        .insert(activities)
        .values({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          contactId: c.id,
          entityType: 'contact',
          entityId: c.id,
          eventType: 'contact_created',
          action: 'create',
          description: `Created contact from ${source || 'scan'}: ${c.firstName} ${c.lastName}`.trim(),
        })
        .catch((err) => console.error('[contacts/scan POST] activity log failed:', err));

      // Increment contact counter
      await tx
        .update(tenants)
        .set({ currentContacts: sql`${tenants.currentContacts} + 1` })
        .where(eq(tenants.id, ctx.tenantId))
        .catch((err) => logError({ error: err, context: 'contacts/scan:increment' }));

      return c;
    });

    // Audit log
    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'contact',
      entityId: contact!.id,
      newData: {
        email: payload.email,
        name: `${payload.firstName} ${payload.lastName}`.trim(),
        source: leadSource,
      },
    });

    return NextResponse.json(
      {
        contact,
        isDuplicate: false,
        parsed: scannedCard,
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    console.error('[contacts/scan POST]', err);
    return apiError(err, 'Internal server error', 500);
  }
});
