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
import { validatePassword } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/errors-server';

// `password` is the user's NEW password, so it must satisfy the full server
// policy enforced by validatePassword() in lib/auth/session.ts (min 12 chars +
// uppercase + number + special char). Enforcing it here means weak passwords
// are rejected with the exact policy message BEFORE resetPassword() runs,
// instead of failing later with a confusing generic 400 (#1173).
const schema = z.object({
  token: z.string().min(1),
  password: z.string().superRefine((value, ctx) => {
    const error = validatePassword(value);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  }),
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

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    void logError({ error: err, context: 'auth/password-reset/confirm POST', requestUrl: request.url, requestMethod: request.method });
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
  }
}