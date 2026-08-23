/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { POST_logout } from '@/lib/auth/api-handlers';

export async function POST(request: NextRequest): Promise<NextResponse> {
  return POST_logout(request);
}
