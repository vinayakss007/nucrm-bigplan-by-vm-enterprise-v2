import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const { full_name, phone, timezone } = await request.json();
    
    const updates: any = {
      updatedAt: new Date()
    };
    
    if (full_name !== undefined) updates.fullName = full_name.trim();
    if (phone !== undefined) updates.phone = phone?.trim() || null;
    if (timezone !== undefined) updates.timezone = timezone;
    
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
  } catch (err: any) { 
    return NextResponse.json({ error: err.message }, { status: 500 }); 
  }
}
