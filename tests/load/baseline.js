/* eslint-disable */
// Baseline read-path load test (#2120: cookie+CSRF auth, live route paths).
//
// Run against the local dev app:   EMAIL=... PASSWORD=... k6 run tests/load/baseline.js
// Run against the deployed app:    SESSIONS_FILE=./sessions.json BASE_URL=https://localhost \
//                                    k6 run --insecure-skip-tls-verify tests/load/baseline.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { BASE_URL, getSession, authHeaders } from './auth.js';

const errorRate = new Rate('errors');
const responseTime = new Trend('response_time');

export const options = __ENV.QUICK
  ? {
      // QUICK=1 [VUS=10 QUICK_DURATION=30s] — short smoke profile (#2120 verify)
      vus: parseInt(__ENV.VUS || '1', 10),
      duration: __ENV.QUICK_DURATION || '30s',
      // Deployed-app dashboard widget p95 is ~2-3s (tracked as perf issues
      // from the 2026-09 QA); smoke mode guards auth+availability, not speed.
      thresholds: {
        http_req_duration: ['p(95)<3500'],
        errors: ['rate<0.1'],
      },
    }
  : {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: 1,
      duration: '30s',
    },
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 0 },
      ],
    },
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 50 },
        { duration: '2m', target: 100 },
        { duration: '1m', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    errors: ['rate<0.1'],
  },
};

function get(headers, path) {
  const res = http.get(`${BASE_URL}${path}`, { headers });
  check(res, { [`${path} 200`]: (r) => r.status === 200 }) || errorRate.add(1);
  responseTime.add(res.timings.duration);
  return res;
}

export default function () {
  const headers = authHeaders(getSession(() => ({
    email: __ENV.EMAIL,
    password: __ENV.PASSWORD,
  })));

  // Dashboard widgets (moved out of the old /dashboard/stats, #2120)
  get(headers, '/api/tenant/dashboard/widgets/stats/contacts');
  get(headers, '/api/tenant/dashboard/widgets/stats/pipeline');
  get(headers, '/api/tenant/dashboard/widgets/stats/revenue');
  get(headers, '/api/tenant/dashboard/widgets/stats/tasks');

  // Lists
  get(headers, '/api/tenant/contacts?limit=20');
  get(headers, '/api/tenant/companies?limit=20');
  get(headers, '/api/tenant/deals?limit=20');
  get(headers, '/api/tenant/tasks?limit=20');
  get(headers, '/api/tenant/search?q=test');

  sleep(1);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data),
    'tests/load/summary.json': JSON.stringify(data),
  };
}

function textSummary(data) {
  const m = data.metrics;
  return `
=== Load Test Results ===

p95: ${m.http_req_duration.values['p(95)'].toFixed(2)}ms
Errors: ${(m.errors.values.rate * 100).toFixed(2)}%
Total Requests: ${m.http_reqs.values.count}
`;
}
