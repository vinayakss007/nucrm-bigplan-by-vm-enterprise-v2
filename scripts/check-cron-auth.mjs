#!/usr/bin/env node
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3298 ask 2 — every cron route goes through the shared cron auth.
 *
 * `lib/auth/cron.ts` ships four layers: the timing-safe secret, an optional source
 * IP allowlist (`CRON_ALLOWED_IPS`), an optional HMAC body signature
 * (`CRON_SIGNING_KEY`), and a structured record written on every denial. Layers 1-3
 * live in `checkCronAuth`, and `verifyCronSecret` is the only caller that also runs
 * `auditCronAuth`. When this screen was written, 20 of the 22 routes under
 * `app/api/cron` compared `x-cron-secret` to `process.env.CRON_SECRET` themselves
 * through `verifySecret`, so setting the two opt-in variables produced an
 * operator-visible configuration that applied to two endpoints and silently ignored
 * twenty — while the module header claimed the opposite.
 *
 * What is enforced, per route:
 *   - it calls `verifyCronSecret`, and does not compare the secret by hand;
 *   - it names its job in the options, because a denial recorded as
 *     `job: 'unknown'` cannot be traced to the scheduler that was refused;
 *   - `lib/auth/cron.ts` still names job/reason/ip in the denial record and still
 *     reads the two opt-in variables — the routes are only as good as the module.
 *
 * A baseline file (`scripts/cron-auth-exempt.json`) is allowed for a route that
 * genuinely cannot use the shared check, but every entry has to state a reason and
 * has to still be needed: an exemption for a route that has since been converted is
 * reported as stale, so the list cannot become a permanent pardon by neglect.
 *
 * Finding zero routes is a failure, not a pass — a moved or renamed directory would
 * otherwise turn this guard into a green light (#3302).
 *
 * Exemptions are reported in the summary line. Nothing here opens a database or
 * reads a credential.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const CRON_DIR = join(ROOT, 'app', 'api', 'cron');
const MODULE = 'lib/auth/cron.ts';
const BASELINE = 'scripts/cron-auth-exempt.json';

const fails = [];
const fail = (message) => fails.push(message);

function routeFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

const routes = routeFiles(CRON_DIR).sort();

if (routes.length === 0) {
  fail(`found no cron route under ${relative(ROOT, CRON_DIR)} — the screen has nothing to check, which is not a pass`);
}

let baseline = [];
const baselinePath = join(ROOT, BASELINE);
if (existsSync(baselinePath)) {
  const parsed = JSON.parse(readFileSync(baselinePath, 'utf8'));
  if (!Array.isArray(parsed)) {
    fail(`${BASELINE} must be an array of { path, reason }`);
  } else {
    baseline = parsed;
  }
}

const exemptReason = new Map();
for (const entry of baseline) {
  const path = entry?.path;
  const reason = typeof entry?.reason === 'string' ? entry.reason.trim() : '';
  if (!path || typeof path !== 'string') {
    fail(`${BASELINE} has an entry with no path: ${JSON.stringify(entry)}`);
    continue;
  }
  if (reason === '') {
    fail(`${BASELINE} exempts ${path} with no written reason — an unexplained pardon is not a baseline`);
    continue;
  }
  exemptReason.set(path, reason);
}

const CALL_RE = /\bverifyCronSecret\s*\(/g;
const NAMED_CALL_RE = /\bverifyCronSecret\s*\([^)]*\{[^}]*\bjob:/g;
// `verifyCronSecret(` does not contain the literal `verifySecret(`, so this matches
// only the by-hand comparison — in any shape, including `const ok = verifySecret(...)`.
const HAND_CMP_RE = /\bverifySecret\s*\(|===\s*process\.env\.CRON_SECRET|process\.env\.CRON_SECRET\s*===?/g;

const checked = [];
let exempted = 0;

for (const file of routes) {
  const rel = relative(ROOT, file).split(/[\\/]/).join('/');
  const src = readFileSync(file, 'utf8');
  const calls = src.match(CALL_RE) ?? [];
  const named = src.match(NAMED_CALL_RE) ?? [];
  const byHand = src.match(HAND_CMP_RE) ?? [];

  if (byHand.length > 0) {
    if (exemptReason.has(rel)) {
      exempted += 1;
      continue;
    }
    fail(`${rel} compares the cron secret by hand (${byHand.length} site(s)) instead of calling verifyCronSecret, so the IP allowlist, the signing layer and the denial record never run (#3298).`);
    continue;
  }

  if (calls.length === 0) {
    fail(`${rel} performs no cron auth at all through verifyCronSecret — if it is genuinely public, exempt it in ${BASELINE} with a reason.`);
    continue;
  }

  if (named.length < calls.length) {
    fail(`${rel} calls verifyCronSecret at ${calls.length} site(s) but names its job at only ${named.length}; a denial recorded as job: 'unknown' cannot be traced to the scheduler that was refused (#3298 ask 3).`);
    continue;
  }

  checked.push(rel);
}

// An exemption that no longer protects anything is drift in the baseline, not a
// decision: the route was converted and somebody left the pardon behind.
for (const path of exemptReason.keys()) {
  if (!existsSync(join(ROOT, path))) {
    fail(`${BASELINE} exempts ${path}, which is not in the tree — stale.`);
    continue;
  }
  const src = readFileSync(join(ROOT, path), 'utf8');
  if ((src.match(HAND_CMP_RE) ?? []).length === 0) {
    fail(`${BASELINE} still exempts ${path}, which no longer compares the secret by hand — stale entry, delete it.`);
  }
}

const modPath = join(ROOT, MODULE);
if (existsSync(modPath)) {
  const src = readFileSync(modPath, 'utf8');
  const record = src.match(/metadata:\s*\{([^}]*)\}/s);
  const fields = record ? record[1] : '';
  for (const field of ['job', 'reason', 'ip']) {
    if (!new RegExp(`\\b${field}:`).test(fields)) {
      fail(`${MODULE} no longer names ${field} in the cron-auth denial record, so a refused scheduler cannot be identified from the log pipeline (#3298 ask 3).`);
    }
  }
  for (const [env, label] of [['CRON_ALLOWED_IPS', 'the source IP allowlist'], ['CRON_SIGNING_KEY', 'the HMAC signing layer']]) {
    if (!src.includes(env)) {
      fail(`${MODULE} no longer reads ${env}, so ${label} is configured by operators and enforced by nobody.`);
    }
  }
}

if (fails.length > 0) {
  for (const message of fails) process.stderr.write(`[check-cron-auth] ${message}\n`);
  process.exit(1);
}

process.stdout.write(
  `[check-cron-auth] OK — ${routes.length} cron route(s) under app/api/cron, ` +
  `${checked.length} through verifyCronSecret with a named job, ${exempted} exempted ` +
  `(${exemptReason.size} baseline entr(y|ies)); ${MODULE} still records job/reason/ip and reads both opt-ins.\n`,
);
