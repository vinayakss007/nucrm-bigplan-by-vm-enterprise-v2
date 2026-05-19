import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const responseTime = new Trend('response_time');

export const options = {
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

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const EMAIL = __ENV.EMAIL || 'superadmin@nucrm.com';
const PASSWORD = __ENV.PASSWORD || 'admin123';

let authToken = '';

export function setup() {
  const loginRes = http.post(`${BASE_URL}/api/auth/login`, 
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  
  const token = loginRes.json('token');
  if (token) {
    authToken = token;
  }
  return { token };
}

export default function(data) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${data.token || authToken}`,
  };

  // Test 1: Dashboard
  const dashboard = http.get(`${BASE_URL}/api/tenant/dashboard/stats`, { headers });
  check(dashboard, { 'dashboard status 200': (r) => r.status === 200 }) || errorRate.add(1);
  responseTime.add(dashboard.timings.duration);

  // Test 2: Contacts List
  const contacts = http.get(`${BASE_URL}/api/tenant/contacts?limit=20`, { headers });
  check(contacts, { 'contacts status 200': (r) => r.status === 200 }) || errorRate.add(1);
  responseTime.add(contacts.timings.duration);

  // Test 3: Companies List
  const companies = http.get(`${BASE_URL}/api/tenant/companies?limit=20`, { headers });
  check(companies, { 'companies status 200': (r) => r.status === 200 }) || errorRate.add(1);
  responseTime.add(companies.timings.duration);

  // Test 4: Deals List
  const deals = http.get(`${BASE_URL}/api/tenant/deals?limit=20`, { headers });
  check(deals, { 'deals status 200': (r) => r.status === 200 }) || errorRate.add(1);
  responseTime.add(deals.timings.duration);

  // Test 5: Tasks List
  const tasks = http.get(`${BASE_URL}/api/tenant/tasks?limit=20`, { headers });
  check(tasks, { 'tasks status 200': (r) => r.status === 200 }) || errorRate.add(1);
  responseTime.add(tasks.timings.duration);

  // Test 6: Search
  const search = http.get(`${BASE_URL}/api/tenant/search?q=test`, { headers });
  check(search, { 'search status 200': (r) => r.status === 200 }) || errorRate.add(1);
  responseTime.add(search.timings.duration);

  sleep(1);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data),
    'tests/load/summary.json': JSON.stringify(data),
  };
}

function textSummary(data) {
  return `
=== Load Test Results ===

Duration: ${data.metrics.http_req_duration.values.p(95).toFixed(2)}ms (p95)
Errors: ${(data.metrics.errors.values.rate * 100).toFixed(2)}%
Total Requests: ${data.metrics.http_reqs.values.count}

=== By Scenario ===`;
}