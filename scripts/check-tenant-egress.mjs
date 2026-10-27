/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Tenant-egress guard (#3292).
 *
 * `lib/security/ssrf.ts` is the only place allowed to decide where a server-side
 * HTTP request goes. Every other server call site either targets a host written
 * into the source as a literal — which no tenant can move — or must go through
 * `safeFetch`, which re-validates the authority and every redirect hop before a
 * socket is opened.
 *
 * The failure this screens is #3292 exactly: `handleMailgun` interpolated
 * `instance.config['base_url']` — the tenant's `integrations.config` JSONB,
 * written verbatim by the integrations and plugin-engine POST handlers — into a
 * bare `fetch` target, and returned the response body to any authenticated
 * member. That is a readable proxy into `169.254.169.254`, into Grafana and
 * Prometheus on loopback (#3273), and into whatever else this single-VM
 * deployment listens on (`deploy/LAUNCH_RUNBOOK.md`).
 *
 * The rule is stated over the request *authority*, because the authority is the
 * only part of a URL an SSRF can use:
 *
 *   A bare global `fetch(` is clean when its first argument's scheme+host is
 *   provably a literal — a string/template whose static text already contains the
 *   whole authority (`https://api.telegram.org/bot${token}/…`, because the hole
 *   sits after the first `/`), a relative target (`/api/…`, so the host is the
 *   request's own), or an authority-position name whose declaration in the same
 *   file is itself one of those. Otherwise the file must call
 *   `safeFetch`/`assertSafeUrl`, or be listed in ALLOWED_FILES with a reason.
 *
 * A name that resolves only through `process.env` is NOT treated as provable:
 * operator configuration is a different trust domain from tenant configuration,
 * and conflating the two is how this class comes back. The env-only sites are
 * therefore named below, one line each, so widening the gate later is a diff a
 * reviewer can read rather than a regex nobody can argue with.
 *
 * Scanned roots are `app/`, `lib/`, `worker.ts` — the app server tree.
 * `scripts/**` is out of scope on purpose: those are operator CLI harnesses
 * (`scripts/preprod-api-e2e.ts`, `scripts/cron-scheduler.ts`) whose target comes
 * from the operator's own environment and which never serve tenant input.
 *
 * Per-file rather than per-line allowlisting: a line number rots the moment
 * someone formats a route, and "is this call site honest?" is a property of the
 * file, not of the line.
 *
 * Usage:
 *   node scripts/check-tenant-egress.mjs              # scan, exit 1 on offenders
 *   node scripts/check-tenant-egress.mjs --json       # machine-readable report
 *   node scripts/check-tenant-egress.mjs --roots=a,b  # scan different prefixes
 *   node scripts/check-tenant-egress.mjs --update     # append TODO-reasoned exemptions
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();

/** Server trust domains that can issue an outbound request on behalf of a tenant. */
const DEFAULT_ROOTS = ['app', 'lib', 'worker.ts'];

const SKIP_RE = /(^|\/)(node_modules|\.next|coverage)\//;
const TEST_RE = /(\.test\.|\.spec\.)/;

/**
 * Files whose authority is not a source literal and whose fetch is not routed
 * through the guard, each with the reason it is acceptable. Every entry was
 * written by hand against #3292; `--update` appends new ones with a `TODO`
 * reason, so an unreviewed exemption shows up in the diff instead of silently
 * passing CI.
 */
export const ALLOWED_FILES = {
  // Client-side helpers: not server egress. The URL is chosen by a component,
  // the browser enforces same-origin, and callers only pass `/api/…` paths.
  'lib/fetch-json.ts': 'client-side same-origin data layer (#2231); imported only from client components with /api/… paths',
  'lib/utils.ts': 'client-side helper; the URL argument comes from a component, not from tenant data',
  'lib/analytics/client.ts': 'relative /api/track/event from a client component',

  // Operator-configured sinks. The host comes from the deployment environment,
  // never from tenant data — moving it requires already controlling the host.
  'lib/grafana.ts': 'OTEL/Loki push to operator-configured LOKI_URL / OTEL_ENDPOINT (#3292 scope is tenant-controlled egress)',
  'lib/critical-error-alert.ts': 'alert webhook from CRITICAL_ERROR_WEBHOOK_URL — deployment env, not tenant data',
  'lib/email/service.ts': 'Discord/Slack alert webhooks from DISCORD_WEBHOOK_URL / SLACK_WEBHOOK_URL — deployment env, not tenant data',
  'lib/sms.ts': 'Twilio REST URL built from the account SID in env — deployment env, not tenant data',
  'lib/esignature.ts': 'vendor base URL from DOCUSIGN_BASE_URL / HELLOSIGN_BASE_URL with a literal fallback — deployment env',
  'lib/calendar-sync/google.ts': 'Google token/calendar authorities are module literals',
  'lib/calendar-sync/outlook.ts': 'Microsoft token/graph authorities are module literals',
  'lib/sdk/realtime.ts': 'published SDK client: baseUrl is set by the integrating developer, not by tenant data',
  'lib/sdk/client.ts': 'published SDK client: same shape as lib/sdk/realtime.ts',
  'lib/integrations/sdk.ts': 'the external NuCRM SDK (`createNuCRM({ baseUrl })`): runs in the integrator\'s own process, and its authority is a constructor argument, not tenant data',

  // Payment wrappers: the base is a literal but the endpoint argument is
  // `endpoint.startsWith('http') ? endpoint : …`, so a caller COULD hand it a
  // full URL. Every current caller passes a path. This is the one entry that is
  // a judgement rather than a proof, so a follow-up should start here.
  'lib/stripe.ts': "Stripe base is a literal; the ternary would accept an absolute endpoint, and today's callers pass paths",
  'lib/razorpay.ts': 'Razorpay base is a literal; same ternary shape as lib/stripe.ts',

  // Self-calls: the authority is the incoming request's own host or the app's
  // configured public URL, so the request cannot reach a new authority.
  'app/api/v1/[...path]/route.ts': 'gateway proxies to a URL built from request.url — same host',
  'app/api/v2/[...path]/route.ts': 'gateway proxies to a URL built from request.url — same host',
  'app/api/tenant/backup/route.ts': "self-call to /api/cron/backup on NEXT_PUBLIC_APP_URL, the app's own public origin",
  'app/auth/login/actions.ts': 'server-action self-call on APP_URL / NEXT_PUBLIC_APP_URL',
  'app/api/bug-report/route.ts': "posts to the app's own /api surface via a URL built from request.url",
  'app/api/embed/form.js/route.ts': 'serves the embeddable widget: the fetch runs in the embedder\'s browser against a literal script origin',

  // Literal authority with only credentials/ids interpolated after the first
  // `/`, so the holes cannot move the host.
  'app/api/webhooks/telegram/bot/route.ts': 'literal api.telegram.org authority; only the bot token is interpolated',
  'app/api/tenant/integrations/telegram/test/route.ts': 'literal api.telegram.org authority; only the bot token is interpolated',
  'app/api/user/telegram/route.ts': 'literal api.telegram.org authority; only the bot token is interpolated',
  'app/api/tenant/whatsapp/send/route.ts': 'literal graph.facebook.com authority; only the phone-number id and token are interpolated',
  'app/api/tenant/whatsapp/templates/route.ts': 'literal graph.facebook.com authority; only the business account id and token are interpolated',
  'instrumentation.ts': 'literal api.telegram.org authority at boot; the bot token comes from env',
};

/** `const name = …` / `let name = …` — the RHS is kept for provenance, not parsed. */
const DECL_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]{0,120})?=\s*([^\n;]{0,240})/g;

/** Same-origin self-call: the authority is the request's own host. */
const SELF_ORIGIN_RE = /\b(?:request\.url|req\.url|nextUrl\b|new URL\([^)]*\.url)/i;

function isSkipped(path) {
  return SKIP_RE.test(path) || TEST_RE.test(path);
}

function walk(abs, out) {
  for (const name of readdirSync(abs)) {
    const p = join(abs, name);
    if (isSkipped(p)) continue;
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Balanced read of the first argument: string-aware, stops at depth-1 `,` or `)`. */
export function firstArgument(src, openParenIndex) {
  let depth = 1;
  let quote = null;
  let arg = '';
  for (let i = openParenIndex + 1; i < src.length && arg.length < 400; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { arg += c + (src[i + 1] ?? ''); i++; continue; }
      if (c === quote) quote = null;
      arg += c;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; arg += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) break;
    } else if (c === ',' && depth === 1) break;
    arg += c;
  }
  return arg.trim();
}

/**
 * Split a target expression into its static text and the names that sit *before
 * the authority closes*. That split is the whole rule: `${token}` inside
 * `https://api.telegram.org/bot${token}/x` lands after the first `/`, so it
 * cannot move the host, while `${base}` at position 0 can move it anywhere.
 */
export function analyzeAuthority(expr) {
  let staticText = '';
  const inAuthority = [];
  let i = 0;
  while (i < expr.length && staticText.length < 300) {
    const c = expr[i];
    if (c === "'" || c === '"') {
      const end = expr.indexOf(c, i + 1);
      staticText += end === -1 ? expr.slice(i + 1) : expr.slice(i + 1, end);
      i = end === -1 ? expr.length : end + 1;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      let ended = false;
      while (j < expr.length) {
        const d = expr[j];
        if (d === '\\') { staticText += expr[j + 1] ?? ''; j += 2; continue; }
        if (d === '`') { ended = true; break; }
        if (d === '$' && expr[j + 1] === '{') {
          let depth = 1;
          let k = j + 2;
          let inner = '';
          while (k < expr.length && depth > 0) {
            const e = expr[k];
            if (e === '{') depth++;
            else if (e === '}') { depth--; if (depth === 0) break; }
            inner += e;
            k++;
          }
          if (!authorityClosed(staticText)) inAuthority.push(inner.trim());
          j = k + 1;
          continue;
        }
        staticText += d;
        j++;
      }
      i = ended ? j + 1 : expr.length;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < expr.length && /[A-Za-z0-9_$.]/.test(expr[j])) j++;
      if (!authorityClosed(staticText)) inAuthority.push(expr.slice(i, j));
      i = j;
      continue;
    }
    i++;
  }
  return { staticText, inAuthority };
}

/**
 * Has the authority portion been finished by the text seen so far?
 *
 * The two characters that must NOT close it are the slashes inside `://`: a
 * scanner that stops at the first `/` reads `https://${host}/x` as a literal
 * authority and misses the hole, which is precisely the shape this gate exists to
 * catch. A root-relative target is closed immediately — everything after `/` is
 * a path, and the host is the caller's own.
 */
function authorityClosed(text) {
  if (/^\//.test(text)) return true;
  const scheme = /^https?:\/\//i.exec(text);
  if (scheme) return /[/?#@]/.test(text.slice(scheme[0].length));
  return /[/?#@]/.test(text);
}

/** Scheme+host written out, or a root-relative path (same origin by construction). */
function authorityIsComplete(staticText) {
  return /^\//.test(staticText) || /^https?:\/\//i.test(staticText);
}

/**
 * Resolve a name used in authority position against *every* declaration of that
 * name in the file. First-wins would be unsound here: three handlers in
 * `lib/integrations/registry.ts` all declare `baseUrl`, and while two assign a
 * literal, the third read the tenant's config bag — proving only the first two
 * would let the third fetch through the gate unnoticed.
 */
function classifyRhs(rhs) {
  if (SELF_ORIGIN_RE.test(rhs)) return { kind: 'self', rhs };
  const usesConfig = /\bconfig\b|\bconfig\[|\.config\b|\bargv\b/.test(rhs);
  const usesEnv = /process\.env/.test(rhs);
  const { staticText, inAuthority } = analyzeAuthority(rhs);
  if (inAuthority.length > 0 || !authorityIsComplete(staticText)) {
    if (usesConfig) return { kind: 'data', rhs };
    if (usesEnv) return { kind: 'env', rhs };
    return { kind: 'data', rhs };
  }
  if (usesEnv || usesConfig) return { kind: 'env', rhs };
  return { kind: 'literal', rhs };
}

export function resolveName(name, decls) {
  const rhss = decls.get(name);
  if (rhss === undefined || rhss.length === 0) return { kind: 'unknown', rhs: '' };
  const kinds = rhss.map(classifyRhs);
  const unsound = kinds.find((k) => k.kind === 'data' || k.kind === 'unknown');
  if (unsound) return unsound;
  const env = kinds.find((k) => k.kind === 'env');
  if (env) return env;
  if (kinds.every((k) => k.kind === 'self')) return { kind: 'self', rhs: rhss[0] };
  return { kind: 'literal', rhs: rhss[0] };
}

function declarations(src) {
  const decls = new Map();
  for (const m of src.matchAll(DECL_RE)) {
    const seen = decls.get(m[1]);
    if (seen) seen.push(m[2]);
    else decls.set(m[1], [m[2]]);
  }
  return decls;
}

const IDENT_RE = /^([A-Za-z_$][\w$]*)/;

export function scanFile(absPath, src) {
  if (/['"]use client['"]/.test(src.slice(0, 500))) return [];
  const rel = relative(ROOT, absPath).replace(/\\/g, '/');
  // The guard is the one file allowed to issue a bare fetch on a data-derived
  // authority — matching on the suffix keeps a fixture-scanned copy honest too.
  if (rel === 'lib/security/ssrf.ts' || rel.endsWith('/lib/security/ssrf.ts')) return [];
  if (ALLOWED_FILES[rel]) return [];

  const decls = declarations(src);
  const offenders = [];
  for (const m of src.matchAll(/(?:^|[^.\w$])fetch\(/g)) {
    const prefix = src.slice(Math.max(0, m.index - 24), m.index + m[0].length);
    if (/safeFetch\s*\($/.test(prefix)) continue;
    if (/await_fetch|globalThis\.fetch\s*\(/.test(prefix)) continue;
    const arg = firstArgument(src, m.index + m[0].length - 1);
    if (arg === '') continue;

    const { staticText, inAuthority } = analyzeAuthority(arg);
    const names = (inAuthority.length > 0 ? inAuthority : [arg])
      .map((expr) => IDENT_RE.exec(expr)?.[1])
      .filter(Boolean);

    // Written-out authority and nothing data-shaped ahead of it.
    if (authorityIsComplete(staticText) && inAuthority.length === 0) continue;

    const unproven = [];
    for (const name of names) {
      const r = resolveName(name, decls);
      if (r.kind === 'literal' || r.kind === 'self') continue;
      // The file runs this exact name through the guard before fetching.
      if (new RegExp(`assertSafeUrl\\(\\s*${name}\\b`).test(src)) continue;
      unproven.push(`${name}:${r.kind}`);
    }
    if (unproven.length === 0 && names.length > 0) continue;
    if (unproven.length === 0 && authorityIsComplete(staticText)) continue;

    offenders.push({
      file: rel,
      line: src.slice(0, m.index).split('\n').length,
      target: arg.slice(0, 90),
      authorities: unproven.length > 0 ? unproven : ['(no written-out authority)'],
    });
  }
  return offenders;
}

export function scanEgress({ roots = DEFAULT_ROOTS } = {}) {
  const files = [];
  // `resolve`, not `join`: a caller pointing the scan at a fixture directory
  // (the tests do this) passes an absolute path, and join would happily append it
  // onto the repo root instead of honouring it.
  for (const r of (Array.isArray(roots) ? roots : [roots])) {
    const abs = resolve(ROOT, r);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(abs, files);
    else files.push(abs);
  }
  const offenders = files
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .flatMap((f) => scanFile(f, readFileSync(f, 'utf8')));
  offenders.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { scanned: files.length, offenders };
}

export function formatReport({ scanned, offenders }) {
  const lines = [
    `[tenant-egress] ${scanned} server files scanned · ${offenders.length} fetch target(s) with an unproven authority`,
  ];
  for (const o of offenders) {
    lines.push(`  ${o.file}:${o.line}  fetch(${o.target}  ← ${o.authorities.join(', ')}`);
  }
  if (offenders.length > 0) {
    lines.push('');
    lines.push('  A request whose authority is not provably a literal in the source must be issued');
    lines.push('  with safeFetch() from lib/security/ssrf.ts (DNS rebinding + private/link-local');
    lines.push('  block + redirect re-validation), or run the URL through assertSafeUrl() first (#3292).');
  }
  return lines.join('\n');
}

const argv = process.argv.slice(2);

function main() {
  const rootsFlag = argv.find((a) => a.startsWith('--roots='));
  const roots = rootsFlag ? rootsFlag.split('=')[1].split(',') : DEFAULT_ROOTS;

  if (argv.includes('--update')) {
    const { offenders } = scanEgress({ roots });
    const byFile = {};
    for (const o of offenders) byFile[o.file] ??= `TODO justify (#3292): ${o.target}`;
    const path = join(ROOT, 'scripts', 'check-tenant-egress.mjs');
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace(
        /const ALLOWED_FILES = \{[\s\S]*?\n\};/,
        `const ALLOWED_FILES = ${JSON.stringify({ ...ALLOWED_FILES, ...byFile }, null, 2)};`,
      ),
    );
    console.log(`allowlisted ${Object.keys(byFile).length} new file(s) with TODO reasons — edit them before committing`);
    return;
  }

  const report = scanEgress({ roots });
  console.log(argv.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
  process.exit(report.offenders.length > 0 ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
