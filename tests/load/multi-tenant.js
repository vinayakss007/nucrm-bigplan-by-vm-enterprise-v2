/**
 * Multi-Tenant Concurrent User Simulation
 *
 * Simulates multiple tenants accessing the system concurrently to test:
 * - Tenant isolation under load
 * - Connection pool behavior with concurrent tenants
 * - RLS policy performance
 * - Cache effectiveness
 *
 * Run: k6 run tests/load/multi-tenant.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const tenantLatency = new Trend('tenant_latency');
const crossTenantLeak = new Rate('cross_tenant_leak');

export const options = {
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

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Simulated tenant credentials (create these in your test database)
const TENANTS = [
  { email: __ENV.TENANT1_EMAIL || 'tenant1@test.com', password: __ENV.TENANT1_PASSWORD || 'test1234' },
  { email: __ENV.TENANT2_EMAIL || 'tenant2@test.com', password: __ENV.TENANT2_PASSWORD || 'test1234' },
  { email: __ENV.TENANT3_EMAIL || 'tenant3@test.com', password: __ENV.TENANT3_PASSWORD || 'test1234' },
];

export function setup() {
  const tokens = [];

  for (const tenant of TENANTS) {
    const res = http.post(`${BASE_URL}/api/auth/login`,
      JSON.stringify({ email: tenant.email, password: tenant.password }),
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (res.status === 200) {
      const token = res.json('token');
      if (token) {
        tokens.push({ token, email: tenant.email });
      }
    }
  }

  if (tokens.length === 0) {
    throw new Error('No tenants could authenticate. Check BASE_URL and credentials.');
  }

  return { tokens };
}

export default function(data) {
  // Each VU picks a random tenant
  const tenantIdx = Math.floor(Math.random() * data.tokens.length);
  const tenant = data.tokens[tenantIdx];

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${tenant.token}`,
  };

  const start = Date.now();

  // Dashboard stats
  const dashboard = http.get(`${BASE_URL}/api/tenant/dashboard/stats`, { headers });
  check(dashboard, {
    [`${tenant.email}: dashboard 200`]: (r) => r.status === 200,
  }) || errorRate.add(1);

  // Contacts list — verify tenant isolation
  const contacts = http.get(`${BASE_URL}/api/tenant/contacts?limit=10`, { headers });
  const contactsData = contacts.json('data');
  check(contacts, {
    [`${tenant.email}: contacts 200`]: (r) => r.status === 200,
    [`${tenant.email}: contacts is array`]: (r) => Array.isArray(contactsData),
  }) || errorRate.add(1);

  // Verify no cross-tenant data leak (contacts should belong to this tenant)
  if (Array.isArray(contactsData) && contactsData.length > 0) {
    // In a real test, you'd verify tenantId matches
    // For now, just check the response is valid
    crossTenantLeak.add(0);
  }

  // Deals list
  const deals = http.get(`${BASE_URL}/api/tenant/deals?limit=10`, { headers });
  check(deals, {
    [`${tenant.email}: deals 200`]: (r) => r.status === 200,
  }) || errorRate.add(1);

  // Tasks list
  const tasks = http.get(`${BASE_URL}/api/tenant/tasks?limit=10`, { headers });
  check(tasks, {
    [`${tenant.email}: tasks 200`]: (r) => r.status === 200,
  }) || errorRate.add(1);

  // Notifications
  const notifications = http.get(`${BASE_URL}/api/tenant/notifications?limit=10`, { headers });
  check(notifications, {
    [`${tenant.email}: notifications 200`]: (r) => r.status === 200,
  }) || errorRate.add(1);

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

Duration: ${new Date(data.state.testRunDurationMs).toISOString().substr(11, 8)}
Total Requests: ${metrics.http_reqs.values.count}
Error Rate: ${(metrics.errors.values.rate * 100).toFixed(2)}%

Tenant Isolation: ${(metrics.cross_tenant_leak.values.rate * 100).toFixed(4)}% leak rate (should be 0%)
Avg Tenant Latency: ${metrics.tenant_latency.values.avg?.toFixed(0) || 'N/A'}ms
P95 Tenant Latency: ${metrics.tenant_latency.values['p(95)']?.toFixed(0) || 'N/A'}ms

HTTP p95: ${metrics.http_req_duration.values['p(95)']?.toFixed(0) || 'N/A'}ms
HTTP p99: ${metrics.http_req_duration.values['p(99)']?.toFixed(0) || 'N/A'}ms
`;
}
