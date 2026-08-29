/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Public signer endpoint for the BUILT-IN (internal) e-signature flow (#1613).
 *
 *   GET  /api/public/sign/[token]   → signer + document + audit trail
 *   POST /api/public/sign/[token]   → { action: 'sign' | 'decline' }
 *
 * No auth — the per-signer token IS the credential. Records real
 * `signing_events` and rolls the request status up. Rate-limited because it is
 * an unauthenticated public route; a first GET also records a `viewed` event.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { checkRateLimit } from '@/lib/rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { db } from '@/drizzle/db';
import { documents, tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import {
  getInternalSigningByToken,
  recordInternalSignerEvent,
  listSigningEvents,
} from '@/lib/esignature';

function clientIp(req: NextRequest): string | undefined {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const limited = await checkRateLimit(req, { action: 'public_sign_view', max: 60, windowMinutes: 5 });
    if (limited) return limited;

    const { token } = await params;
    const view = await getInternalSigningByToken(token);
    // Uniform 404 so an unauthenticated probe cannot enumerate tokens/state.
    if (!view) return NextResponse.json({ error: 'Signing request not found' }, { status: 404 });

    // Record a 'viewed' event on first open (no-op once resolved/viewed).
    if (!view.alreadyResolved && view.status === 'sent') {
      await recordInternalSignerEvent(token, 'viewed', {
        ip: clientIp(req),
        userAgent: req.headers.get('user-agent') || undefined,
      });
    }

    // Minimal document + seller branding for the signer page.
    const doc = await db.query.documents.findFirst({
      where: eq(documents.id, view.documentId),
      columns: { id: true, name: true },
    });
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, view.request.tenantId),
      columns: { name: true, logoUrl: true, primaryColor: true },
    });

    const events = await listSigningEvents(view.request.id);

    return NextResponse.json({
      signer: { name: view.signer.name, email: view.signer.email },
      request: {
        id: view.request.id,
        status: view.status,
        signed_at: view.signer.signedAt ?? null,
        declined_at: view.signer.declinedAt ?? null,
      },
      document: { id: doc?.id ?? view.documentId, name: doc?.name ?? 'Document' },
      seller: {
        name: tenant?.name ?? 'Sender',
        logo: tenant?.logoUrl ?? null,
        primary_color: tenant?.primaryColor ?? '#7c3aed',
      },
      events,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const limited = await checkRateLimit(req, { action: 'public_sign_action', max: 20, windowMinutes: 5 });
    if (limited) return limited;

    const { token } = await params;
    const body = await readJsonBody(req) as { action?: string };
    const action = body?.action;

    if (action !== 'sign' && action !== 'decline') {
      return NextResponse.json({ error: "action must be 'sign' or 'decline'" }, { status: 400 });
    }

    const result = await recordInternalSignerEvent(
      token,
      action === 'sign' ? 'signed' : 'declined',
      { ip: clientIp(req), userAgent: req.headers.get('user-agent') || undefined },
    );

    if (!result.ok) {
      if (result.reason === 'not_found') {
        return NextResponse.json({ error: 'Signing request not found' }, { status: 404 });
      }
      if (result.reason === 'already_resolved') {
        return NextResponse.json({ error: 'You have already responded to this document' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Unable to record your response' }, { status: 400 });
    }

    return NextResponse.json({ ok: true, status: result.status });
  } catch (err) {
    return apiError(err);
  }
}
