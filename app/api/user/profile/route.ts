/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireCsrf } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { updateProfileSchema } from '@/lib/api/schemas';
import { withApiRoute } from '@/lib/api/with-api-route';

export const PATCH = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const csrf = requireCsrf(request); // #1835: in-handler CSRF defense-in-depth (after auth)
    if (csrf) return csrf;

    const rawBody = await readJsonBody(request);
    const validated = validateBody(updateProfileSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: any = {
      updatedAt: new Date()
    };
    
    if (v.first_name !== undefined) updates.fullName = (v.first_name ?? '').trim();
    if (v.last_name !== undefined) updates.lastName = (v.last_name ?? '').trim();
    if (v.phone !== undefined) updates.phone = v.phone?.trim() || null;
    if (v.timezone !== undefined) updates.timezone = v.timezone;
    if (v.avatar_url !== undefined) updates.avatarUrl = v.avatar_url;
    if (v.language !== undefined) updates.language = v.language;

    // Email change is auth-sensitive: normalize, enforce uniqueness explicitly
    // (a UNIQUE-constraint collision would otherwise surface as a generic 500),
    // and drop emailVerified so the verification gate re-applies to the new
    // address instead of silently inheriting the old verified state.
    if (v.email !== undefined) {
      const newEmail = v.email.trim().toLowerCase();
      const [current] = await db.select({ email: users.email })
        .from(users)
        .where(eq(users.id, ctx.userId))
        .limit(1);

      if (current && newEmail !== current.email.toLowerCase()) {
        const [taken] = await db.select({ id: users.id })
          .from(users)
          .where(eq(users.email, newEmail))
          .limit(1);
        if (taken && taken.id !== ctx.userId) {
          return NextResponse.json({ error: 'That email is already in use' }, { status: 409 });
        }
        updates.email = newEmail;
        updates.emailVerified = false;
      }
    }

    if (Object.keys(updates).length <= 1) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Optimistic concurrency: reject stale writes
    const expectedUpdatedAt = rawBody?.expectedUpdatedAt ?? rawBody?._updated_at;
    if (expectedUpdatedAt) {
      const guard = await concurrencyGuard(db, users, ctx.userId, null, expectedUpdatedAt);
      if (guard) return guard;
    }

    const [user] = await db.update(users)
      .set(updates)
      .where(eq(users.id, ctx.userId))
      .returning({ 
        id: users.id, 
        email: users.email, 
        full_name: users.fullName, 
        phone: users.phone, 
        timezone: users.timezone 
      });

    return NextResponse.json({ user });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    return apiError(err); 
  }
});
