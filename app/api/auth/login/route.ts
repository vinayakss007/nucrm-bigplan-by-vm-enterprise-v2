import { NextRequest, NextResponse } from 'next/server';
import { POST_login } from '@/lib/auth/api-handlers';

export async function POST(request: NextRequest): Promise<NextResponse> {
  return POST_login(request);
}
