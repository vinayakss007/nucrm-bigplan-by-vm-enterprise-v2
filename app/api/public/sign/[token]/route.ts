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
import { tenants } from '@/drizzle/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { withTenantContext, NO_USER_SENTINEL } from '@/lib/db/rls';
import {
  getInternalSigningByToken,
  recordInternalSignerEvent,
  writeInternalSignerEvent,
  listSigningEvents,
} from '@/lib/esignature';

/**
 * `generateSignerToken()` is `randomBytes(32).toString('base64url')` (43 chars of
 * [A-Za-z0-9_-]); the bound is loose enough to admit any token an existing link
 * could hold and tight enough that a junk path param 404s the way every other
 * "no" path here does, instead of throwing its way into a 500 through the lookup
 * context's 512-character guard.
 */
const SIGNER_TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;

function clientIp(req: NextRequest): string | undefined {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const limited = await checkRateLimit(req, { action: 'public_sign_view', max: 60, windowMinutes: 5 });
    if (limited) return limited;

    const { token } = await params;
    if (!SIGNER_TOKEN_RE.test(token)) {
      return NextResponse.json({ error: 'Signing request not found' }, { status: 404 });
    }
    const view = await getInternalSigningByToken(token);
    // Uniform 404 so an unauthenticated probe cannot enumerate tokens/state.
    if (!view) return NextResponse.json({ error: 'Signing request not found' }, { status: 404 });

    // #2468: the branding read, the audit trail and the first-open `viewed` write
    // all key off a tenant-policyed table, and the credential that resolved them
    // names a workspace only after it has been read. One transaction, scoped to
    // the tenant the signing request row carries — never to anything in the URL,
    // header or body. `db.query.*` on the pool, which these three statements used
    // to be, returns zero rows for the role the application runs as.
    const page = await withTenantContext(view.request.tenantId, NO_USER_SENTINEL, async (tx) => {
      if (!view.alreadyResolved && view.status === 'sent') {
        await writeInternalSignerEvent(tx, view, 'viewed', {
          ip: clientIp(req),
          userAgent: req.headers.get('user-agent') || undefined,
        });
      }

      const tenant = await tx.query.tenants.findFirst({
        where: and(eq(tenants.id, view.request.tenantId), isNull(tenants.deletedAt)),
        columns: { name: true, logoUrl: true, primaryColor: true },
      });

      // The `documents` row is no longer read here: getInternalSigningByToken
      // already admits it or 404s the link (#2380), so a second read of the same
      // row would be a second gate to keep in sync for nothing.
      const events = await listSigningEvents(tx, view.request.id);

      return { tenant, events };
    });

    return NextResponse.json({
      signer: { name: view.signer.name, email: view.signer.email },
      request: {
        id: view.request.id,
        status: view.status,
        signed_at: view.signer.signedAt ?? null,
        declined_at: view.signer.declinedAt ?? null,
      },
      document: { id: view.documentId, name: view.documentName },
      seller: {
        name: page.tenant?.name ?? 'Sender',
        logo: page.tenant?.logoUrl ?? null,
        primary_color: page.tenant?.primaryColor ?? '#7c3aed',
      },
      events: page.events,
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
    if (!SIGNER_TOKEN_RE.test(token)) {
      return NextResponse.json({ error: 'Signing request not found' }, { status: 404 });
    }
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
