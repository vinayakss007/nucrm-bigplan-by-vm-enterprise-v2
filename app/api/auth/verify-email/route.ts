/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { users, emailVerifications } from '@/drizzle/schema';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { createHash } from 'crypto';
import { checkRateLimit } from '@/lib/rate-limit';
import { withAuthLookupContext, withSecurityContext } from '@/lib/db/rls';

const schema = z.object({ token: z.string().min(1) });

export async function POST(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'verify-email', max: 10, windowMinutes: 60 });
    if (limited) return limited;

    const body = await readJsonBody(request);
    const validated = validateBody(schema, body);
    if (validated instanceof NextResponse) return validated;
    const { token } = validated.data;
    
    const hash = createHash('sha256').update(token).digest('hex');
    
    // PP-026: redeeming a verification link is a pre-auth read — the holder has
  // proven nothing RLS recognises yet, so this needs the narrow auth_lookup
  // privilege (email_verifications_auth_select + users_auth_lookup in 0088).
  const result = await withAuthLookupContext(async (tx) =>
      await tx.select({
      id: emailVerifications.id,
      userId: emailVerifications.userId,
      email: users.email,
    })
    .from(emailVerifications)
    .innerJoin(users, eq(users.id, emailVerifications.userId))
    .where(and(
      eq(emailVerifications.tokenHash, hash),
      isNull(emailVerifications.usedAt),
      gt(emailVerifications.expiresAt, new Date())
    ))
    .limit(1)
    );

    const row = result[0];
    if (!row) return NextResponse.json({ error: 'Invalid or expired verification link' }, { status: 400 });
    
    // The write is authorised by the token itself, so it runs in the platform
  // security context rather than pretending to be a tenant request.
  await withSecurityContext(async (tx) => {
      await tx.update(users)
        .set({ emailVerified: true })
        .where(eq(users.id, row.userId));
      
      await tx.update(emailVerifications)
        .set({ usedAt: new Date() })
        .where(eq(emailVerifications.id, row.id));
    });

    return NextResponse.json({ ok: true, email: row.email });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    return apiError(err); 
  }
}
