/**
 * Password Reset Request API
 * POST /api/auth/password-reset/request
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { requestPasswordReset } from '@/lib/auth/password-reset';
import { checkRateLimit } from '@/lib/rate-limit';

const schema = z.object({ email: z.string().email() });

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
    const validated = validateBody(schema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const result = await requestPasswordReset(v.email);

    // Always return success to prevent email enumeration
    return NextResponse.json({
      success: true,
      message: result.message,
    });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[password-reset-request]', err);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}