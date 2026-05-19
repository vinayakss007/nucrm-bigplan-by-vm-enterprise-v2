import { NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq, count, sql } from 'drizzle-orm';

// Public endpoint — checks if any SUPER ADMIN users exist yet
export async function GET() {
  try {
    const [row] = await db.select({ 
      count: count() 
    })
    .from(users)
    .where(eq(users.isSuperAdmin, true));

    return NextResponse.json({ setup_done: (row?.count ?? 0) > 0 });
  } catch (err) {
    // DB not connected yet — setup not done
    console.error('[SetupCheck] Error:', err);
    return NextResponse.json({ setup_done: false });
  }
}
