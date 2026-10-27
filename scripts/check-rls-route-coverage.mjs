/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * RLS route-coverage guard (#1838 + #3288).
 *
 * RULE 1 (#1838) — the cross-tenant-leak shape.
 *
 * RLS tenant isolation is only enforced for queries that run inside a
 * withPinnedConnection scope. withApiRoute()/withTenantScope() (lib/api/with-api-route.ts)
 * establish that scope for a whole handler. A tenant API route that authenticates
 * (requireAuth / requireTenantCtx) and then runs its own `db` queries WITHOUT being
 * wrapped runs those queries on unpinned connections with an empty tenant GUC —
 * RLS provides no isolation there, so a single missing app-level tenantId filter
 * becomes a cross-tenant leak.
 *
 * This guard fails CI when any route file under app/api/** :
 *   - authenticates (requireAuth or requireTenantCtx), AND
 *   - runs a db.* query, AND
 *   - is NOT wrapped in withApiRoute / withTenantScope.
 *
 * #1838 (hardening): the scan root is the WHOLE app/api tree, not just
 * app/api/tenant. Authenticated, db-querying routes also live under
 * app/api/superadmin, app/api/admin, app/api/user, etc.; scanning only the
 * tenant subtree left those as a blind spot where an unwrapped route could be
 * added without the guard noticing. The match is precise (an actual
 * requireAuth(/requireTenantCtx( CALL, not a mention in a comment), so public
 * routes that only use verifyToken/getSessionToken are correctly ignored.
 *
 * RULE 2 (#3288) — the silent-failure shape, which rule 1 cannot see by construction.
 *
 * Rule 1 only looks at files that authenticate. The routes that ESTABLISH an
 * identity never call requireAuth — and that is exactly where an empty RLS
 * context is fatal in a way nothing reports. `users` has no SELECT policy an
 * unprivileged connection can satisfy: `users_read_self` needs `app.current_user`,
 * `users_super_admin_read` needs `app.is_super_admin`, and `users_auth_lookup`
 * (0088) needs `app.auth_lookup` — a value that does not exist before somebody
 * logs in. So `db.query.users.findFirst(…)` on the pool (`lib/db/pool.ts` clears
 * every `app.*` GUC on acquire AND release) matches zero rows, forever, for every
 * address in the database, and the route written to answer "ok, we do not reveal
 * whether that email exists" answers it whether or not the lookup worked. Nothing
 * errors. Nothing logs. #3288 is that route, and #3289, #3290 and #3304 were found
 * with the same grep.
 *
 * THE RULE: a route file that neither authenticates nor wraps (so: the anonymous
 * surface) and touches an identity/credential table through the BARE POOL is a
 * finding. Statement level, not file level, and that is the whole screen —
 * `app/api/auth/forgot-password/route.ts` already called `withTokenIssueContext`
 * two lines below the broken SELECT, so a file-level "does this file use a context
 * helper anywhere" rule was satisfiable by the dead route and found nothing. The
 * receiver decides: `db.`/`database.`/`pool.` is the cleared pool; `tx.` is a
 * transaction somebody opened a privilege inside of.
 *
 * The table list is deliberately narrow — identity and credential tables, not
 * business tables. A tenant-scoped `leads` read filtered to zero rows is a bug
 * somebody notices; a `users` read filtered to zero rows is a feature that reports
 * success. `sessions`, `password_resets`, `oauth_*` and `email_verifications` are
 * here for the same reason: each is guarded by a policy keyed on a value a
 * pre-auth request cannot have.
 *
 * Usage:
 *   node scripts/check-rls-route-coverage.mjs
 *   node scripts/check-rls-route-coverage.mjs --json
 *   node scripts/check-rls-route-coverage.mjs --explain
 *   node scripts/check-rls-route-coverage.mjs --root <fixture-dir> [--baseline <file>]
 *   node scripts/check-rls-route-coverage.mjs --update | --print-baseline
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, relative, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..');
const DEFAULT_BASELINE = join(HERE, 'rls-preauth-baseline.json');

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name === 'route.ts' || name === 'route.tsx') out.push(p);
  }
  return out;
}

// Require an actual CALL — `requireAuth(` / `requireTenantCtx(` — so a mention
// in a comment or a doc string (e.g. "...without the full requireAuth machinery")
// never trips the guard now that the scan covers the whole app/api tree.
const AUTH_RE = /\b(requireAuth|requireTenantCtx)\s*\(/;
const DB_RE = /\bdb\.(select|insert|update|delete|query|execute|transaction)\b/;
// Must be USED (called as a wrapper), not merely imported — so a route that
// imports withApiRoute but exports a bare handler is still caught.
const WRAP_USED_RE = /\b(withApiRoute|withTenantScope)\s*\(/;
// A bare handler export that is NOT going through a wrapper.
const BARE_EXPORT_RE = /export\s+async\s+function\s+(GET|POST|PATCH|PUT|DELETE)\b/;

/**
 * Rule 2's file-level scope: a route is on the anonymous surface when nothing in it
 * establishes a session or a tenant. Anything else is rule 1's territory, where a
 * bare `db` inside a wrapped handler already runs on a pinned, contextualised
 * connection — flagging those would be 60-odd false positives, not a ratchet.
 */
const CONTEXT_ESTABLISHED_RE = /\b(?:requireAuth|requireTenantCtx|requireSuperAdmin|getSessionFromRequest|withApiRoute|withTenantScope|withPinnedConnection|authenticateRequest)\s*\(/;

/** Drizzle identifier and the SQL name, because a raw statement uses the latter. */
const IDENTITY_TABLES = [
  ['users', 'users'],
  ['sessions', 'sessions'],
  ['passwordResets', 'password_resets'],
  ['oauthClients', 'oauth_clients'],
  ['oauthCodes', 'oauth_codes'],
  ['oauthTokens', 'oauth_tokens'],
  ['emailVerifications', 'email_verifications'],
].map(([ident, sqlName]) => ({
  sqlName,
  // `.from(users)`, `.insert(passwordResets)`, `.query.users` — the identifier as the
  // target of a clause, allowing the call to break across lines.
  chain: new RegExp(`(?:\\.from|\\.insert|\\.update|\\.delete)\\s*\\(\\s*${ident}\\b|\\.query\\.${ident}\\b`),
  // `select … from password_resets …` inside a raw sql`` statement.
  raw: new RegExp(`\\b(?:from|into|update|join)\\s+${sqlName}\\b`, 'i'),
}));

/** The pool, under any of the three names this repository binds it to. */
const BARE_POOL_RE = /\b(?:db|database|pool)\s*\.\s*(?:query|select|insert|update|delete|execute)\b/g;

/**
 * Full-line comments describe code; they are not code, and a comment can never be a
 * statement's receiver. Blank lines are kept so line numbers still match the file.
 */
function stripComments(text) {
  const lines = text.split('\n');
  let inBlock = false;
  return lines.map((line) => {
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      return '';
    }
    if (/^\s*(\/\*|\/\*!)/.test(line)) {
      if (!line.includes('*/')) inBlock = true;
      return '';
    }
    if (/^\s*(\/\/|#|--)/.test(line)) return '';
    return line;
  }).join('\n');
}

/** A statement runs to its `;`, capped so an unterminated tail cannot swallow the file. */
function statementAt(lines, lineIndex, column) {
  const MAX = 1200;
  let text = '';
  for (let i = lineIndex; i < Math.min(lines.length, lineIndex + 24); i++) {
    text += i === lineIndex ? lines[i].slice(column) : lines[i];
    const end = text.indexOf(';');
    if (end >= 0) return text.slice(0, Math.min(end, MAX));
    if (text.length > MAX) return text.slice(0, MAX);
  }
  return text.slice(0, MAX);
}

function identityTablesIn(statement) {
  return IDENTITY_TABLES
    .filter(({ chain, raw }) => chain.test(statement) || raw.test(statement))
    .map(({ sqlName }) => sqlName);
}

/**
 * @returns {{findings: Array, allowed: number, hits: Array, scanned: number,
 *            offenders: Array, notApplicable?: boolean}}
 */
export function analyse({ root = DEFAULT_ROOT, baseline = {} } = {}) {
  const apiDir = join(root, 'app', 'api');
  if (!existsSync(apiDir)) {
    return { notApplicable: true, findings: [], allowed: 0, hits: [], scanned: 0, offenders: [] };
  }
  const files = walk(apiDir);

  // ── Rule 1 (#1838): authenticated, unwrapped, querying ─────────────────────
  const offenders = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (!AUTH_RE.test(src) || !DB_RE.test(src)) continue;
    const wrapped = WRAP_USED_RE.test(src);
    const hasBareExport = BARE_EXPORT_RE.test(src);
    // Offender if it never actually calls a wrapper, OR it still exports a bare
    // `export async function GET/POST/...` handler (which bypasses the wrapper).
    if (!wrapped || hasBareExport) offenders.push(relative(root, file).split('\\').join('/'));
  }

  // ── Rule 2 (#3288): anonymous surface, identity table, bare pool ───────────
  const hits = [];
  const seen = new Set();
  for (const file of files) {
    const rel = relative(root, file).split('\\').join('/');
    const text = readFileSync(file, 'utf8');
    if (CONTEXT_ESTABLISHED_RE.test(text)) continue;
    const lines = stripComments(text).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      BARE_POOL_RE.lastIndex = 0;
      let m;
      while ((m = BARE_POOL_RE.exec(line)) !== null) {
        for (const table of identityTablesIn(statementAt(lines, i, m.index))) {
          const key = `${rel}|PREAUTH_UNCONTEXTED_READ|${i + 1}|${table}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push({
            check: 'PREAUTH_UNCONTEXTED_READ',
            file: rel,
            line: i + 1,
            detail: `${table} read or written on the bare pool with no RLS context`,
            source: line.trim().slice(0, 160),
          });
        }
        if (m.index === BARE_POOL_RE.lastIndex) BARE_POOL_RE.lastIndex += 1;
      }
    }
  }

  const findings = [];
  let allowed = 0;
  // The allowance is a COUNT, not a flag: a file tolerated at 1 that grows a second
  // un-contexted identity read is a finding again. Otherwise the ratchet would stop
  // counting the moment anything was ever excused.
  const spent = {};
  for (const hit of hits) {
    const key = `${hit.file}|${hit.check}`;
    const allowance = baseline[key];
    const n = typeof allowance === 'number' ? allowance : 0;
    if ((spent[key] ?? 0) < n) {
      spent[key] = (spent[key] ?? 0) + 1;
      allowed += 1;
      continue;
    }
    findings.push(hit);
  }
  // An allowance whose site is gone is a regression the other way — the ratchet is
  // shrink-only — and an allowance nobody justified is a gate that quietly stops
  // being true.
  const reasons = baseline._reasons && typeof baseline._reasons === 'object' ? baseline._reasons : {};
  for (const [key, value] of Object.entries(baseline)) {
    if (key.startsWith('_') || typeof value !== 'number') continue;
    const [file, check] = key.split('|');
    if (!hits.some((h) => h.file === file && h.check === check)) {
      findings.push({ check: 'BASELINE_STALE', file, line: 0, detail: `no ${check} site left to tolerate — lower this entry to 0` });
    }
    if (!reasons[key]) {
      findings.push({ check: 'BASELINE_UNREASONED', file, line: 0, detail: `${key} has no reason recorded in the baseline's _reasons` });
    }
  }

  return { findings, allowed, hits, scanned: files.length, offenders };
}

export function readBaseline(p) {
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`baseline ${p} is not readable JSON: ${e.message}`);
    return {};
  }
}

function baselineMap(hits, existing) {
  const counts = {};
  for (const h of hits) {
    const key = `${h.file}|${h.check}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const kept = existing?._reasons && typeof existing._reasons === 'object'
    ? Object.fromEntries(Object.entries(existing._reasons).filter(([k]) => k in counts))
    : {};
  return {
    _comment: existing?._comment
      ?? '#3288 shrink-only ratchet for scripts/check-rls-route-coverage.mjs rule 2: per-file count of identity/credential-table statements that run on the bare pool with no RLS context, known, reviewed and NOT yet fixed. Lower a number when the route takes its read through a context helper (withAuthLookupContext / withAuthResolutionContext / withOAuthClientLookupContext / withTenantContext); raising it is a regression. Deleting this file sets every allowance to 0. Every entry needs a reason in _reasons (BASELINE_UNREASONED).',
    ...(Object.keys(kept).length ? { _reasons: kept } : {}),
    ...counts,
  };
}

const EXPLAIN = `rls route-coverage screen (#1838 + #3288) — what each check asserts:
  AUTH_UNWRAPPED             (rule 1) a route that authenticates and queries db without
                             withApiRoute/withTenantScope: unpinned, so RLS gives no isolation
  PREAUTH_UNCONTEXTED_READ   (rule 2) an identity/credential table (users, sessions,
                             password_resets, oauth_clients, oauth_codes, oauth_tokens,
                             email_verifications) touched through the bare pool in a file that
                             establishes no context. These tables' SELECT policies key on
                             app.current_user / app.is_super_admin / app.auth_lookup — values a
                             pre-auth request cannot have — so the statement answers zero rows
                             and a route that reports success when it finds nothing looks correct.
  BASELINE_STALE             an allowance with no matching site left — shrink-only ratchet
  BASELINE_UNREASONED        an allowance with no reason recorded in "_reasons"
The receiver decides rule 2: db. is the pool with every app.* GUC cleared, tx. is a transaction
someone opened a privilege inside of. The test is per statement, not per file, because the dead
forgot-password route already contained withTokenIssueContext two lines below the broken SELECT.
`;

export function main(argv = process.argv.slice(2)) {
  const opt = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : argv[i + 1];
  };
  if (argv.includes('--explain')) {
    console.log(EXPLAIN);
    return 0;
  }
  const root = resolve(opt('--root') ?? DEFAULT_ROOT);
  const baselineOpt = opt('--baseline');
  // A --root changes the baseline too, so a fixture never inherits the repo's allowances: they
  // are per-file, and the whole point is that a route cannot exempt itself by being copied.
  const baselinePath = baselineOpt
    ? resolve(root, baselineOpt)
    : resolve(root, 'scripts', basename(DEFAULT_BASELINE));
  const baseline = readBaseline(baselinePath);
  const result = analyse({ root, baseline });

  if (result.notApplicable) {
    console.error(`rls route coverage: no app/api directory under ${root} — nothing to screen`);
    return 2;
  }

  if (argv.includes('--update') || argv.includes('--print-baseline')) {
    const payload = baselineMap(result.hits, baseline);
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    if (argv.includes('--update')) {
      writeFileSync(baselinePath, text);
      const entries = Object.keys(payload).filter((k) => typeof payload[k] === 'number');
      console.log(`wrote ${baselinePath} (${entries.length} entries, ${result.hits.length} un-contexted identity statement(s))`);
      const unreasoned = entries.filter((k) => !payload._reasons?.[k]);
      if (unreasoned.length) {
        console.log(`  ${unreasoned.length} allowance(s) still need a reason in "_reasons" (BASELINE_UNREASONED):`);
        for (const k of unreasoned) console.log(`\t  ${k}`);
      }
      return 0;
    }
    console.log(text.trimEnd());
    return 0;
  }

  if (argv.includes('--json')) {
    console.log(JSON.stringify({
      findings: result.findings,
      allowed: result.allowed,
      hits: result.hits,
      offenders: result.offenders,
      scanned: result.scanned,
    }, null, 2));
    return result.findings.length || result.offenders.length ? 1 : 0;
  }

  if (result.offenders.length > 0) {
    console.error(
      '\n\u001b[31m✖ RLS route-coverage guard failed (#1838).\u001b[0m\n' +
        '\n' +
        '  The following tenant API routes authenticate and run db queries but are\n' +
        '  NOT wrapped in withApiRoute()/withTenantScope(). Their queries run outside\n' +
        '  the pinned-connection scope, so RLS does not isolate them and a missing\n' +
        '  app-level tenantId filter would leak across tenants.\n\n' +
        result.offenders.map((f) => `    - ${f}`).join('\n') +
        '\n\n' +
        '  Fix: wrap the handler, e.g.\n' +
        '    export const GET = withApiRoute(async (request) => { ... });\n',
    );
    return 1;
  }

  if (result.findings.length === 0) {
    console.log(`[check-rls-route-coverage] OK — ${result.scanned} API routes scanned, all authenticated db-querying handlers are wrapped, and no anonymous route touches an identity table on the bare pool (${result.allowed} tolerated in the baseline).`);
    return 0;
  }
  for (const f of result.findings) {
    console.log(`${f.check}\t${f.file}:${f.line}\t${f.detail}`);
    if (f.source) console.log(`\t  ${f.source}`);
  }
  console.log(`\n${result.findings.length} pre-auth identity statement(s) with no RLS context (#3288). A SELECT on these tables answers zero rows for every input, and a route that returns "ok" when it finds nothing cannot tell that apart from success. Take the read through withAuthLookupContext / withAuthResolutionContext / withOAuthClientLookupContext / withTenantContext, or record it in scripts/rls-preauth-baseline.json with a reason.`);
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main());
}
