/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
/**
 * Panel loading for the superadmin dashboard. Extracted from the page component
 * because #3408 changed all four fetches at once: a failed panel must be
 * distinguishable from an empty one. Keeping the logic here also keeps the
 * page component under its #422 file-size ratchet.
 */
import { useEffect, useState } from 'react';
import { logError } from '@/lib/errors-client';

export interface HealthCheck {
  service: string;
  status: string;
  latency_ms?: number;
}

export interface RevenueData {
  mrr?: { mrr?: number; paying?: number; trialing?: number; free_tier?: number };
  events?: { id: string; event_type: string; tenant_name?: string; amount?: number; created_at: string }[];
}

export interface UsageData {
  growth?: Array<Record<string, unknown>>;
}

export interface ActivityItem {
  type: string;
  name?: string;
  message?: string;
  created_at?: string;
  timestamp?: string;
}

type PanelResult<T> = { data: T; failed: boolean };

/**
 * #3408: `fetch(...).then(r => r.json()).catch(() => ({}))` collapsed a 500, a
 * failure envelope and a network error into the same empty object; the health
 * panel then computed `[].every(...) === true` and reported "ALL UP" while the
 * health API was down. One helper for all four panels keeps the failure
 * explicit without letting one panel's outage blank the whole dashboard.
 */
async function loadPanel<T>(url: string, signal: AbortSignal, fallback: T): Promise<PanelResult<T>> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
    const body = await res.json();
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      const err = b.error;
      if (b.ok === false || b.success === false || (typeof err === 'string' && err.length > 0)
        || (err && typeof err === 'object' && 'message' in err)) {
        throw new Error(`${url} returned a failure envelope`);
      }
    }
    return { data: body as T, failed: false };
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    logError({ error: err, context: 'superadmin-dashboard-panel' });
    return { data: fallback, failed: true };
  }
}

export function useDashboardPanels() {
  const [healthChecks, setHealthChecks] = useState<HealthCheck[]>([]);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthFailed, setHealthFailed] = useState(false);
  const [revenueData, setRevenueData] = useState<RevenueData | null>(null);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([
      loadPanel<{ checks?: HealthCheck[] }>('/api/superadmin/health', signal, {}),
      loadPanel<RevenueData>('/api/superadmin/revenue', signal, {} as RevenueData),
      loadPanel<UsageData>('/api/superadmin/usage', signal, {} as UsageData),
      loadPanel<{ bulk_ops?: ActivityItem[]; settings_changes?: ActivityItem[]; critical?: ActivityItem[] }>(
        '/api/superadmin/recent-activity?limit=10', signal, {}),
    ]).then(([health, rev, usage, act]) => {
      if (ignore || signal.aborted) return;
      const checks = health.data.checks;
      setHealthChecks(checks ?? []);
      // Zero checks is not "all up" either: the health endpoint always returns
      // four, so an empty/absent array means the response was not usable.
      setHealthFailed(health.failed || !Array.isArray(checks) || checks.length === 0);
      setRevenueData(rev.data);
      setUsageData(usage.data);
      const items = [
        ...(act.data.bulk_ops ?? []),
        ...(act.data.settings_changes ?? []),
        ...(act.data.critical ?? []),
      ].sort((a: ActivityItem, b: ActivityItem) => {
        const ta = a.created_at ?? a.timestamp ?? '';
        const tb = b.created_at ?? b.timestamp ?? '';
        return tb.localeCompare(ta);
      }).slice(0, 10);
      setActivity(items);
      setHealthLoading(false);
      setActivityLoading(false);
    }).catch(err => {
      // loadPanel rethrows only AbortError; this is a last-resort guard so the
      // panels cannot stay in their loading state forever on an unexpected bug.
      if ((err as Error)?.name === 'AbortError' || ignore) return;
      logError({ error: err, context: 'superadmin-dashboard-load' });
      setHealthFailed(true);
      setHealthLoading(false);
      setActivityLoading(false);
    });
    return () => { ignore = true; controller.abort(); };
  }, []);

  return {
    healthChecks, healthLoading, healthFailed,
    revenueData, usageData, activity, activityLoading,
  };
}
