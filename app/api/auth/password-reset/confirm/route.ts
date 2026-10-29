/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Password Reset Confirm API
 * POST /api/auth/password-reset/confirm
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { resetPassword } from '@/lib/auth/password-reset';
import { newPasswordSchema } from '@/lib/api/schemas/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/errors-server';

// `password` is a NEW password, so it is checked here rather than failing later
// inside resetPassword() with a generic 400 (#1173). The field is the shared
// derived schema, so this route cannot state a different minimum (#3277).
const schema = z.object({
  token: z.string().min(1),
  password: newPasswordSchema,
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

    const body = await readJsonBody(request);
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

 
 
  } catch (err) {
    void logError({ error: err, context: 'auth/password-reset/confirm POST', requestUrl: request.url, requestMethod: request.method });
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
  }
}