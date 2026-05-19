import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST_signup } from '@/lib/auth/api-handlers';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = await checkRateLimit(request, { action: 'signup', max: 5, windowMinutes: 1 }); if (limited) return limited;
  return POST_signup(request);
}
