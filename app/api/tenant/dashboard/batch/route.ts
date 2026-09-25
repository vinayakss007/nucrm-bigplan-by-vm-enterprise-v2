/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { GET as widgetActivity } from '../widgets/activity/route';
import { GET as widgetContactsRecent } from '../widgets/contacts/recent/route';
import { GET as widgetDealsClosing } from '../widgets/deals/closing/route';
import { GET as widgetFollowUps } from '../widgets/follow-ups/route';
import { GET as widgetInvoices } from '../widgets/invoices/route';
import { GET as widgetLeads } from '../widgets/leads/route';
import { GET as widgetNotifications } from '../widgets/notifications/route';
import { GET as widgetStatsContacts } from '../widgets/stats/contacts/route';
import { GET as widgetStatsPipeline } from '../widgets/stats/pipeline/route';
import { GET as widgetStatsRevenue } from '../widgets/stats/revenue/route';
import { GET as widgetStatsTasks } from '../widgets/stats/tasks/route';
import { GET as widgetTasks } from '../widgets/tasks/route';
import { GET as widgetTickets } from '../widgets/tickets/route';

/**
 * #1993: one dashboard mount used to fire ~15 concurrent /api/* fetches
 * (layout + stats + 13 widgets), each pinning one of the 5 pooled DB
 * connections so the rest queued. This endpoint lets the client collapse
 * every whitelisted widget fetch into a single request; the handlers run
 * in-process with the original request's auth headers, bounded to 3 at a
 * time so a batch can never exhaust the pool. Responses are passed through
 * verbatim, so each widget's own caching/ETag behavior is unchanged.
 */
const WIDGET_ROUTES: Record<string, (request: NextRequest) => Promise<Response>> = {
  '/api/tenant/dashboard/widgets/activity': widgetActivity,
  '/api/tenant/dashboard/widgets/contacts/recent': widgetContactsRecent,
  '/api/tenant/dashboard/widgets/deals/closing': widgetDealsClosing,
  '/api/tenant/dashboard/widgets/follow-ups': widgetFollowUps,
  '/api/tenant/dashboard/widgets/invoices': widgetInvoices,
  '/api/tenant/dashboard/widgets/leads': widgetLeads,
  '/api/tenant/dashboard/widgets/notifications': widgetNotifications,
  '/api/tenant/dashboard/widgets/stats/contacts': widgetStatsContacts,
  '/api/tenant/dashboard/widgets/stats/pipeline': widgetStatsPipeline,
  '/api/tenant/dashboard/widgets/stats/revenue': widgetStatsRevenue,
  '/api/tenant/dashboard/widgets/stats/tasks': widgetStatsTasks,
  '/api/tenant/dashboard/widgets/tasks': widgetTasks,
  '/api/tenant/dashboard/widgets/tickets': widgetTickets,
};

const MAX_PATHS = 20;
const CONCURRENCY = 3;

export const GET = withApiRoute(async (request: NextRequest) => {
  const raw = request.nextUrl.searchParams.get('paths') ?? '';
  const paths = [...new Set(raw.split(',').map(p => p.trim()).filter(Boolean))];

  if (paths.length === 0) {
    return NextResponse.json({ error: 'paths query parameter is required' }, { status: 400 });
  }
  if (paths.length > MAX_PATHS) {
    return NextResponse.json({ error: `too many paths (max ${MAX_PATHS})` }, { status: 400 });
  }
  const unknown = paths.find(p => !WIDGET_ROUTES[p]);
  if (unknown) {
    return NextResponse.json({ error: `unknown widget path: ${unknown}` }, { status: 400 });
  }

  const results: Record<string, { status: number; body: unknown }> = {};
  const queue = [...paths];

  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      try {
        const subRequest = new NextRequest(new URL(path, request.url), {
          method: 'GET',
          headers: request.headers,
        });
        const res = await WIDGET_ROUTES[path]!(subRequest);
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = { error: 'widget returned a non-JSON response' };
        }
        results[path] = { status: res.status, body };
      } catch (err) {
        logError({ error: err, context: `dashboard/batch ${path}` });
        results[path] = { status: 500, body: { error: 'widget fetch failed' } };
      }
    }
  });
  await Promise.all(workers);

  return NextResponse.json({
    data: { results },
    meta: { count: paths.length, concurrency: CONCURRENCY },
  });
});
