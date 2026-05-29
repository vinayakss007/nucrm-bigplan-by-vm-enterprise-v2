import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { sessions } from '@/drizzle/schema';
import { eq, and, gt, ne, desc } from 'drizzle-orm';
import { hashToken } from '@/lib/auth/session';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const currentToken = request.cookies.get('nucrm_session')?.value;
    const currentHash = currentToken ? await hashToken(currentToken) : null;
    
    const userSessions = await db.query.sessions.findMany({
        limit: 200,
      where: and(
        eq(sessions.userId, ctx.userId),
        gt(sessions.expiresAt, new Date())
      ),
      orderBy: [desc(sessions.createdAt)]
    });
    
    const data = userSessions.map(s => ({ 
      id: s.id, 
      ip_address: s.ipAddress, 
      user_agent: s.userAgent, 
      created_at: s.createdAt, 
      expires_at: s.expiresAt, 
      is_current: s.tokenHash === currentHash 
    }));
    
    return NextResponse.json({ data });
  } catch (err: any) { 
    return apiError(err); 
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const { sessionId, revokeAll } = await request.json();
    const currentToken = request.cookies.get('nucrm_session')?.value;
    const currentHash = currentToken ? await hashToken(currentToken) : null;
    
    if (revokeAll) {
      await db.delete(sessions)
        .where(and(
          eq(sessions.userId, ctx.userId),
          ne(sessions.tokenHash, currentHash || '')
        ));
    } else if (sessionId) {
      // Can only revoke own sessions
      await db.delete(sessions)
        .where(and(
          eq(sessions.id, sessionId),
          eq(sessions.userId, ctx.userId),
          ne(sessions.tokenHash, currentHash || '')
        ));
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) { 
    return apiError(err); 
  }
}
