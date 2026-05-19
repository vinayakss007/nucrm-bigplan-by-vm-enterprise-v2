/**
 * Password Reset Request API
 * POST /api/auth/password-reset/request
 */

import { NextRequest, NextResponse } from 'next/server';
import { requestPasswordReset } from '@/lib/auth/password-reset';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 3 requests per hour per IP
    const limited = await checkRateLimit(request, { 
      action: 'password_reset', 
      max: 3, 
      windowMinutes: 60 
    });
    if (limited) return limited;

    const body = await request.json();
    const email = body.email?.trim();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const result = await requestPasswordReset(email);

    // Always return success to prevent email enumeration
    return NextResponse.json({
      success: true,
      message: result.message,
    });

  } catch (err: any) {
    console.error('[password-reset-request]', err);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}