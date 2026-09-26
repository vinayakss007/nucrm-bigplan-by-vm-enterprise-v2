/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
// Shared cookie+CSRF auth for the k6 load scripts (#2120).
//
// The live app authenticates with an HttpOnly `nucrm_session` cookie plus a
// double-submit CSRF pair (`nucrm_csrf_token` cookie + `x-csrf-token` header);
// there is no bearer token. Login is heavily rate-limited (10/15min), so for
// real load runs you should pre-create sessions once
// (tests/load/make-sessions.sh) and point SESSIONS_FILE at the resulting JSON
// array of {session, csrf} objects — sessions are reused round-robin by VUs.
//
// Without SESSIONS_FILE each VU falls back to its own csrf-token + login
// handshake, which only works when the login limiter is relaxed (dev instances).

import http from 'k6/http';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

function loadSessionsFile() {
  if (!__ENV.SESSIONS_FILE) return [];
  let raw;
  try {
    // k6 `open` exists only in the init context, which is where this runs.
    raw = JSON.parse(open(__ENV.SESSIONS_FILE, 'r'));
  } catch (e) {
    throw new Error(`SESSIONS_FILE="${__ENV.SESSIONS_FILE}" could not be read/parsed: ${e}`);
  }
  const list = Array.isArray(raw) ? raw : raw.sessions;
  const valid = (list || []).filter((s) => s && s.session && s.csrf);
  if (valid.length === 0) throw new Error('SESSIONS_FILE contained no {session, csrf} entries');
  return valid;
}

const SESSIONS = loadSessionsFile();

// Module state is per-VU in k6, so this caches one session/login per user.
let mine = null;

function cookieValue(res, name) {
  const c = res.cookies && res.cookies[name];
  return c && c.length ? c[0].value : null;
}

function loginFresh(email, password) {
  if (!email || !password) {
    throw new Error('No SESSIONS_FILE entry and EMAIL/PASSWORD (or TENANTn_*) env not set — cannot authenticate (#2120).');
  }
  const csrfRes = http.get(`${BASE_URL}/api/auth/csrf-token`);
  if (csrfRes.status !== 200) {
    throw new Error(`csrf-token failed: ${csrfRes.status} ${csrfRes.body}`);
  }
  const csrf = cookieValue(csrfRes, 'nucrm_csrf_token') || csrfRes.json('token');
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf } }
  );
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${res.body}`);
  }
  const session = cookieValue(res, 'nucrm_session');
  // Login regenerates the CSRF token; prefer the freshly-set cookie.
  const freshCsrf = cookieValue(res, 'nucrm_csrf_token') || csrf;
  if (!session) throw new Error(`login OK but no nucrm_session cookie for ${email}`);
  return { session, csrf: freshCsrf };
}

/**
 * Resolve this VU's session: round-robin over SESSIONS_FILE entries when
 * present, else perform the per-VU login handshake once and cache it.
 * `creds` may be a {email, password} object or a thunk (evaluated only in
 * the no-SESSIONS_FILE path, so env vars stay optional when sessions exist).
 * `pick` optionally returns an index (multi-tenant: one session per tenant).
 */
export function getSession(creds, pick) {
  if (SESSIONS.length > 0) {
    if (!mine) {
      const idx = typeof pick === 'function' ? pick(SESSIONS.length) : (parseInt(__VU, 10) - 1) % SESSIONS.length;
      mine = SESSIONS[idx];
    }
    return mine;
  }
  if (!mine) {
    const c = typeof creds === 'function' ? creds() : creds;
    mine = loginFresh(c && c.email, c && c.password);
  }
  return mine;
}

/** Headers for every tenant-API request once a session exists. */
export function authHeaders(s, extra = {}) {
  return Object.assign(
    {
      'Content-Type': 'application/json',
      'x-csrf-token': s.csrf,
      Cookie: `nucrm_session=${s.session}; nucrm_csrf_token=${s.csrf}`,
      // Direct-app runs: spread across per-IP rate limiters (TRUST_PROXY=true)
      // so the limiter, not a single bucket, is what's under test.
      'X-Forwarded-For': `203.0.113.${(parseInt(__VU, 10) % 250) + 1}`,
    },
    extra
  );
}

export function requireEnv(name) {
  const v = __ENV[name];
  if (!v) throw new Error(`env ${name} is required (scripts carry no fake default credentials, see #2120)`);
  return v;
}
