/**
 * Password Reset Confirm API
 * POST /api/auth/password-reset/confirm
 */

import { NextRequest, NextResponse } from 'next/server';
import { resetPassword } from '@/lib/auth/password-reset';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 5 attempts per hour per IP
    const limited = await checkRateLimit(request, { 
      action: 'password_reset_confirm', 
      max: 5, 
      windowMinutes: 60 
    });
    if (limited) return limited;

    const body = await request.json();
    const token = body.token?.trim();
    const newPassword = body.password || body.new_password;

    if (!token) {
      return NextResponse.json({ error: 'Reset token is required' }, { status: 400 });
    }

    if (!newPassword) {
      return NextResponse.json({ error: 'New password is required' }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const result = await resetPassword(token, newPassword);

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: result.message,
    });

  } catch (err: any) {
    console.error('[password-reset-confirm]', err);
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
  }
}