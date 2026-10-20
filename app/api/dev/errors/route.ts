/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * GET /api/dev/errors — the error log the dev dashboard polls (#2881).
 *
 * This is the second of the two handlers that were written but never routed:
 * `export async function GET_ERRORS` at `app/api/dev/dashboard/route.ts:182`. Next.js
 * only dispatches a route module's HTTP-method exports, so the name decided it was
 * dead code while the body — gate, query, shape — made it look like the live endpoint
 * the page was calling at `page.tsx:79` (`/api/dev/errors?limit=20`).
 *
 * The Errors tab rendered its empty state while `devLogger.error()` was filling the
 * very buffer this reads. It also dropped `stack`, which the tab has always rendered
 * (`page.tsx:394`), so no error would have shown its trace even once the 404 stopped.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireDevAccess } from '@/lib/dev-access';
import { devLogger } from '@/lib/dev-logger';
import { clampInt } from '@/lib/api/query-params';

/** `devLogger.error()` keeps the last 200 (`lib/dev-logger.ts:323`). */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  const access = await requireDevAccess(request);
  if (access instanceof NextResponse) return access;

  const { searchParams } = new URL(request.url);
  const limit = clampInt(searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);

  const errors = devLogger.exportLogs().errors;

  return NextResponse.json({
    errors: errors.slice(-limit).map((e) => ({
      message: e.message,
      context: e.context,
      // the buffer stores epoch millis; the page's `ErrorLog.timestamp` is a string and
      // renders it through `new Date(...).toLocaleString()`
      timestamp: new Date(e.timestamp).toISOString(),
      stack: e.stack,
    })),
    total: errors.length,
  });
}
