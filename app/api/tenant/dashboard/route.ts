/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest } from 'next/server';
import { GET as getStats } from './stats/route';

export async function GET(request: NextRequest) {
  return getStats(request);
}
