import { NextRequest, NextResponse } from 'next/server';
import { POST_logout } from '@/lib/auth/api-handlers';

export async function POST(request: NextRequest): Promise<NextResponse> {
  return POST_logout(request);
}
