import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { validateBody } from '@/lib/api/validate';
import { updateProfileSchema } from '@/lib/api/schemas';

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const rawBody = await request.json();
    const validated = validateBody(updateProfileSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: any = {
      updatedAt: new Date()
    };
    
    if (v.first_name !== undefined) updates.fullName = (v.first_name ?? '').trim();
    if (v.last_name !== undefined) updates.lastName = (v.last_name ?? '').trim();
    if (v.email !== undefined) updates.email = v.email;
    if (v.phone !== undefined) updates.phone = v.phone?.trim() || null;
    if (v.timezone !== undefined) updates.timezone = v.timezone;
    if (v.avatar_url !== undefined) updates.avatarUrl = v.avatar_url;
    if (v.language !== undefined) updates.language = v.language;
    
    if (Object.keys(updates).length <= 1) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
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
}
