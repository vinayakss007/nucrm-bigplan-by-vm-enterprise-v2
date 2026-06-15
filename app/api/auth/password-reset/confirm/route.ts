/**
 * Password Reset Confirm API
 * POST /api/auth/password-reset/confirm
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { resetPassword } from '@/lib/auth/password-reset';
import { checkRateLimit } from '@/lib/rate-limit';

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

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
    const validated = validateBody(schema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const result = await resetPassword(v.token, v.password);

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: result.message,
    });

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[password-reset-confirm]', err);
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
  }
}