/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * GET /api/health/live — liveness (#1972).
 *
 * Answers instantly with 200 as soon as the Node process can route a request;
 * deliberately touches no DB, cache or dependency. This is the cheap signal
 * for container healthchecks and tight polling loops that only need "the
 * server is up". Deep dependency checks stay on /api/health (readiness).
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { status: 'alive', service: 'nucrm-app', timestamp: new Date().toISOString() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
