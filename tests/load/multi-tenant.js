/**
 * Multi-Tenant Concurrent User Simulation (#2120: cookie+CSRF auth, live paths)
 *
 * Simulates multiple tenants accessing the system concurrently to test:
 * - Tenant isolation under load
 * - Connection pool behavior with concurrent tenants
 * - RLS policy performance
 * - Cache effectiveness
 *
 * Provide one session per tenant: either a SESSIONS_FILE JSON array whose
 * entries are picked round-robin, or TENANTn_EMAIL/TENANTn_PASSWORD env for
 * a per-VU dev-instance login (login is rate-limited, sessions preferred).
 *
 * Run: SESSIONS_FILE=./sessions.json k6 run tests/load/multi-tenant.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { BASE_URL, getSession, authHeaders } from './auth.js';

const errorRate = new Rate('errors');
const tenantLatency = new Trend('tenant_latency');
const crossTenantLeak = new Rate('cross_tenant_leak');

export const options = __ENV.QUICK
  ? { vus: parseInt(__ENV.VUS || '3', 10), duration: __ENV.QUICK_DURATION || '20s' }
  : {
  scenarios: {
    multi_tenant: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 3 },
        { duration: '1m', target: 10 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],
    errors: ['rate<0.05'],
    cross_tenant_leak: ['rate==0'], // Zero tolerance for data leaks
  },
};

// Tenant identities for the no-SESSIONS_FILE fallback. No fake defaults:
// set TENANTn_EMAIL/TENANTn_PASSWORD or run make-sessions.sh (#2120).
const TENANTS = [
  { email: __ENV.TENANT1_EMAIL, password: __ENV.TENANT1_PASSWORD },
  { email: __ENV.TENANT2_EMAIL, password: __ENV.TENANT2_PASSWORD },
  { email: __ENV.TENANT3_EMAIL, password: __ENV.TENANT3_PASSWORD },
].filter((t) => t.email && t.password);

export default function () {
  // With SESSIONS_FILE: auth.getSession round-robins VUs over the session list
  // (one session = one tenant). Without it: per-VU login as TENANTn creds.
  const tenant = TENANTS.length > 0 ? TENANTS[(parseInt(__VU, 10) - 1) % TENANTS.length] : {};
  const s = getSession(() => tenant);
  const headers = authHeaders(s);
  const label = `vu-${__VU}`;

  const start = Date.now();

  // Dashboard widget stats (the old /dashboard/stats endpoint no longer exists)
  const stats = http.get(`${BASE_URL}/api/tenant/dashboard/widgets/stats/contacts`, { headers });
  check(stats, { [`${label}: dashboard stats 200`]: (r) => r.status === 200 }) || errorRate.add(1);

  // Contacts list — verify tenant isolation
  const contacts = http.get(`${BASE_URL}/api/tenant/contacts?limit=10`, { headers });
  const contactsData = contacts.json('data');
  check(contacts, {
    [`${label}: contacts 200`]: (r) => r.status === 200,
    [`${label}: contacts is array`]: () => Array.isArray(contactsData),
  }) || errorRate.add(1);

  // RLS + the API only ever return the session tenant's rows; a tenantId
  // field leaking through would be the alarm bell.
  if (Array.isArray(contactsData)) {
    const leaks = contactsData.filter((c) => c && c.tenantId && s.tenantId && c.tenantId !== s.tenantId);
    crossTenantLeak.add(leaks.length > 0 ? 1 : 0);
  }

  const deals = http.get(`${BASE_URL}/api/tenant/deals?limit=10`, { headers });
  check(deals, { [`${label}: deals 200`]: (r) => r.status === 200 }) || errorRate.add(1);

  const tasks = http.get(`${BASE_URL}/api/tenant/tasks?limit=10`, { headers });
  check(tasks, { [`${label}: tasks 200`]: (r) => r.status === 200 }) || errorRate.add(1);

  const notifications = http.get(`${BASE_URL}/api/tenant/notifications?limit=10`, { headers });
  check(notifications, { [`${label}: notifications 200`]: (r) => r.status === 200 }) || errorRate.add(1);

  tenantLatency.add(Date.now() - start);

  sleep(1);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, 'Multi-Tenant Concurrent Load Test'),
    'tests/load/multi-tenant-summary.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(data, title) {
  const metrics = data.metrics;
  return `
=== ${title} ===

Total Requests: ${metrics.http_reqs.values.count}
Error Rate: ${(metrics.errors.values.rate * 100).toFixed(2)}%

Tenant Isolation: ${(metrics.cross_tenant_leak.values.rate * 100).toFixed(4)}% leak rate (should be 0%)
Avg Tenant Latency: ${metrics.tenant_latency.values.avg?.toFixed(0) || 'N/A'}ms
P95 Tenant Latency: ${metrics.tenant_latency.values['p(95)']?.toFixed(0) || 'N/A'}ms

HTTP p95: ${metrics.http_req_duration.values['p(95)']?.toFixed(0) || 'N/A'}ms
HTTP p99: ${metrics.http_req_duration.values['p(99)']?.toFixed(0) || 'N/A'}ms
`;
}
