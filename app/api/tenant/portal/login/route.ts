/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { db } from '@/drizzle/db';
import { portalClients, platformSettings } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { readJsonBody } from '@/lib/api/validate';
import { rateLimiter } from '@/lib/rate-limit';

const PORTAL_CONFIG_KEY = 'portal_config';

/** Constant-time string comparison to prevent timing attacks */
function timingSafeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const aPadded = a.padEnd(maxLen, '\0');
  const bPadded = b.padEnd(maxLen, '\0');
  let result = 0;
  for (let i = 0; i < maxLen; i++) {
    result |= aPadded.charCodeAt(i) ^ bPadded.charCodeAt(i);
  }
  return result === 0 && a.length === b.length;
}

async function getPortalConfig(tenantId: string) {
  const [setting] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(and(
      eq(platformSettings.tenantId, tenantId),
      eq(platformSettings.key, PORTAL_CONFIG_KEY)
    ))
    .limit(1);

  return setting?.value ? JSON.parse(String(setting.value)) : { enabled: false };
}

export async function POST(request: NextRequest) {
  try {
    const { email, token, tenant_id } = await readJsonBody(request);

    if (!email || !token || !tenant_id) {
      return NextResponse.json({ error: 'Email, token, and tenant_id required' }, { status: 400 });
    }

    // Validate tenant_id format (UUID) to prevent injection
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenant_id)) {
      return NextResponse.json({ error: 'Invalid tenant_id format' }, { status: 400 });
    }

    // Rate limit: max 10 login attempts per email per 15 minutes
    const rateLimitKey = `portal_login:${email}`;
    const { allowed } = await rateLimiter.check(rateLimitKey, 10, 15 * 60 * 1000);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many login attempts. Please try again later.' }, { status: 429 });
    }

    const config = await getPortalConfig(tenant_id);
    if (!config.enabled) {
      return NextResponse.json({ error: 'Portal not enabled' }, { status: 403 });
    }

    const [client] = await db
      .select()
      .from(portalClients)
      .where(and(
        eq(portalClients.email, email),
        eq(portalClients.tenantId, tenant_id),
        eq(portalClients.isActive, true)
      ))
      .limit(1);

    if (!client) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Use constant-time comparison to prevent timing attacks
    const isValid = timingSafeEqual(client.accessToken, token) && client.expiresAt > new Date();
    if (!isValid) {
      return NextResponse.json({ error: 'Token expired or invalid' }, { status: 401 });
    }

    const sessionToken = uuidv4();
    const sessionExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db
      .update(portalClients)
      .set({ lastLoginAt: new Date() })
      .where(eq(portalClients.id, client.id));

    return NextResponse.json({
      ok: true,
      session: {
        token: sessionToken,
        expiresAt: sessionExpiry,
      },
      client: {
        id: client.id,
        name: client.name,
        email: client.email,
      },
      permissions: {
        quotes: config.allow_quotes,
        invoices: config.allow_invoices,
        cases: config.allow_cases,
      },
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[portal login]', err);
    return apiError(err);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenant_id = searchParams.get('tenant_id');

    if (!tenant_id) {
      return NextResponse.json({ error: 'Tenant ID required' }, { status: 400 });
    }

    const config = await getPortalConfig(tenant_id);

    return NextResponse.json({
      enabled: config.enabled,
      features: {
        quotes: config.allow_quotes,
        invoices: config.allow_invoices,
        cases: config.allow_cases,
      },
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[portal status]', err);
    return apiError(err);
  }
}