/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * GET /api/dev/logs — the request log the dev dashboard's Requests tab polls (#2881).
 *
 * `app/dev/dashboard/page.tsx:77` has asked for `/api/dev/logs?limit=50` for as long
 * as that page has existed, and `app/api/dev/dashboard/route.ts:16` advertised the
 * URL in its own header. Nothing answered it: the file's `ls` shows only `dashboard`,
 * and `git log --diff-filter=D -- app/api/dev/logs` is empty, so no handler was ever
 * deleted — this one was never written. Next's 404 became a query error the page does
 * not read, `logsQuery.data?.requests ?? []` became an empty array, and the Requests
 * tab told a developer running the app that no request had been made.
 *
 * The data has been in this process the whole time: the `/api/v1/*` handlers call
 * `devLogger.request()` on their way out, and `exportLogs().requests` is that buffer.
 * This route is the read half of it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireDevAccess } from '@/lib/dev-access';
import { devLogger } from '@/lib/dev-logger';
import { clampInt } from '@/lib/api/query-params';

/** The buffer `devLogger.request()` keeps is capped at 1000 (`lib/dev-logger.ts:206`). */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export async function GET(request: NextRequest) {
  const access = await requireDevAccess(request);
  if (access instanceof NextResponse) return access;

  const { searchParams } = new URL(request.url);
  // Clamped rather than `parseInt(raw || '100')`, which is what the two sibling
  // handlers did: `?limit=abc` parses to NaN there, and `slice(-NaN)` is `slice(0)` —
  // an unbounded dump of every request path, status and duration the process recorded.
  const limit = clampInt(searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);

  const requests = devLogger.exportLogs().requests;

  return NextResponse.json({
    requests: requests.slice(-limit),
    total: requests.length,
  });
}
