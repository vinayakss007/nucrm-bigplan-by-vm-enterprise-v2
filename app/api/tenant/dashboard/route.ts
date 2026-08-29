/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest } from 'next/server';
import { GET as getStats } from './stats/route';

// #1615: getStats is already wrapped in withApiRoute (pins one connection for
// the whole handler body). This alias delegates to it directly, so the pin and
// RLS enforcement are inherited; no separate wrap is needed here.
export async function GET(request: NextRequest) {
  return getStats(request, undefined);
}
