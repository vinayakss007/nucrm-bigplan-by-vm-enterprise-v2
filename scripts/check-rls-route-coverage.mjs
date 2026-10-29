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
 * RULE 3 (#3290) — the same silence, outside the HTTP surface.
 *
 * Rules 1 and 2 live in app/api/**, where something always *could* pin a connection. A BullMQ
 * processor cannot: lib/db/request-connection.ts has no request to key on, so the handler IS the
 * lifecycle. worker.ts read `integrations` and wrote `notifications` and `lead_warming_messages`
 * through the bare pool with no `app.current_tenant` — the INSERT raised 42501 and was retried into
 * the failed set, and the claim-then-send answered zero rows, which the code printed as
 * `skipped: already_processed` for messages that were never dispatched.
 *
 * This is the one place the narrow-table-list reasoning of rule 2 is deliberately widened. Above, "a
 * `leads` read that comes back empty is a bug somebody notices" holds because a person is on the
 * other end of the request. In a queue nothing is on the other end: the log line is the only surface,
 * so a business table that answers zero rows is precisely the failure nobody sees. Hence: any table
 * the schema declares with a tenant column, in a process entry point, on the bare pool.
 *
 * The table list is read out of `drizzle/schema/**` rather than transcribed, so a new tenant-scoped
 * table joins the screen the day it is declared — a hand-kept list is how `lead_warming_messages`
 * stayed invisible here.
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

function walk(dir, accept = (name) => name === 'route.ts' || name === 'route.tsx') {
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
    if (st.isDirectory()) out.push(...walk(p, accept));
    else if (accept(name)) out.push(p);
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
// Proof that a route the session gate steps over is not simply unauthenticated: these are the
// mechanisms the codebase verifies credentials with when it is not looking up a session. Named
// rather than inferred, so adding one to the list is a deliberate act.
const AUTH_MECHANISM_RE = /\b(?:verifySCIMToken|verifyWebhookSignature|verifyApiKey|verifySignature|resolveApiKey|timingSafeEqual|createHmac|scryptSync)\b/g;

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

/**
 * Drizzle chains are written across lines, and the formatter puts the receiver on its own line once
 * the chain is long:
 *
 *     const [countResult] = await db
 *       .select({ count: sql`count(*)` })
 *       .from(users)
 *
 * Rule 2's per-line scan reads that as nothing at all — `BARE_POOL_RE` needs `db` and `.select` in
 * the same line — so the guard reported "no anonymous route touches an identity table on the bare
 * pool" while `app/api/scim/v2/Users/route.ts` did it twice per handler (#3303). A statement's
 * receiver is a property of the statement, not of the line it happens to break on.
 *
 * So: glue a line to the next one while the line ends on a pool name and the next line opens with
 * the chain call. Both conditions have to hold together, which is what keeps the fusion narrow —
 * `const cfg = { name: "db" };` followed by `.select(…)` does not fuse (the line ends with `};`),
 * and `(tx) => tx` followed by `.select(…)` does not fuse (the receiver is not the pool).
 * `origStart` maps each fused line back to the source line a human has to open.
 */
function fuseChains(rawLines) {
  const lines = [];
  const origStart = [];
  for (let k = 0; k < rawLines.length; k++) {
    let cur = rawLines[k];
    const start = k;
    while (
      /\b(?:db|database|pool)\s*$/.test(cur.trimEnd()) &&
      k + 1 < rawLines.length &&
      /^\s*\.\s*(?:query|select|insert|update|delete|execute)\b/.test(rawLines[k + 1])
    ) {
      k += 1;
      cur = `${cur} ${rawLines[k].trim()}`;
    }
    lines.push(cur);
    origStart.push(start + 1);
  }
  return { lines, origStart };
}

function identityTablesIn(statement) {
  return IDENTITY_TABLES
    .filter(({ chain, raw }) => chain.test(statement) || raw.test(statement))
    .map(({ sqlName }) => sqlName);
}

/**
 * The `{ … }` starting at the index of its opening brace, or the rest of the file when unbalanced.
 * Good enough to read a `pgTable` body; a schema file with a brace inside a string literal would
 * only ever widen the window, never shorten it, and widening errs toward flagging more.
 */
function balancedBraces(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  return text.slice(from);
}

/**
 * Every table the schema declares with a tenant column, read from the schema rather than
 * transcribed: `utils.tenantId()` is `uuid('tenant_id')` (`drizzle/schema/utils.ts:47`), so a table
 * body saying `tenantId:` is a body with the column every `tenant_isolation` policy compares. A new
 * tenant table joins this set the day it is declared, which is the point — a transcription would be
 * the list that forgot `lead_warming_messages` and lets #3290 through.
 */
function tenantScopedTables(root) {
  const dir = join(root, 'drizzle', 'schema');
  const names = new Set();
  if (!existsSync(dir)) return names;
  for (const file of walk(dir, (name) => name.endsWith('.ts'))) {
    // Comments stripped first: a table's own doc block may name another table's column.
    const text = stripComments(readFileSync(file, 'utf8'));
    let at = 0;
    while ((at = text.indexOf('pgTable(', at)) >= 0) {
      const named = /^'([^']+)'/.exec(text.slice(at + 'pgTable('.length));
      const brace = text.indexOf('{', at);
      if (!named || brace < 0) break;
      const body = balancedBraces(text, brace);
      if (/\btenantId:/.test(body) || /'tenant_id'/.test(body)) names.add(named[1]);
      at = brace + body.length;
    }
  }
  return names;
}

/** `lead_warming_messages` → `leadWarmingMessages`, the drizzle export this repo names tables by. */
const camelIdent = (sqlName) => sqlName.replace(/[-_]([a-z0-9])/g, (_, c) => c.toUpperCase());

function tenantTablesIn(statement, tables) {
  const out = [];
  for (const sqlName of tables) {
    const chain = new RegExp(`(?:\\.from|\\.insert|\\.update|\\.delete)\\s*\\(\\s*${camelIdent(sqlName)}\\b`);
    const raw = new RegExp(`\\b(?:from|into|update|join)\\s+${sqlName}\\b`, 'i');
    if (chain.test(statement) || raw.test(statement)) out.push(sqlName);
  }
  return out;
}

/**
 * Rule 3 (#3290): the long-running processes in this repository, named one by one.
 *
 * A route gets its RLS context from the request lifecycle (`lib/db/request-connection.ts` pins a
 * connection per request after `withApiRoute` resolves the session). Nothing equivalent exists for a
 * BullMQ processor or a cron tick: the handler IS the lifecycle, and if it does not open a context
 * the pool connection it borrows has no tenant. That is why these files are screened separately and
 * why the check is on the receiver rather than on the presence of a wrapper somewhere in the file.
 *
 * Deliberately a list, not a glob: `scripts/` holds a hundred one-off tools whose DB access is
 * operator-run and single-tenant by construction, and letting the screen guess which processes are
 * long-running would flag half of them and miss the next real worker. A new daemon means a line here.
 */
const ENTRY_POINTS = ['worker.ts', 'realtime.ts', 'instrumentation.ts', 'scripts/cron-scheduler.ts'];

/**
 * @returns {{findings: Array, allowed: number, hits: Array, scanned: number,
 *            entryPoints: number, offenders: Array, skippedAuthenticators: Array,
 *            notApplicable?: boolean}}
 */
export function analyse({ root = DEFAULT_ROOT, baseline = {} } = {}) {
  const apiDir = join(root, 'app', 'api');
  const entryFiles = ENTRY_POINTS
    .map((rel) => ({ rel, abs: join(root, rel) }))
    .filter(({ abs }) => existsSync(abs));
  if (!existsSync(apiDir) && entryFiles.length === 0) {
    return { notApplicable: true, findings: [], allowed: 0, hits: [], scanned: 0, entryPoints: 0, offenders: [], skippedAuthenticators: [] };
  }
  const files = existsSync(apiDir) ? walk(apiDir) : [];

  // ── Rule 1 (#1838): authenticated, unwrapped, querying ─────────────────────
  const offenders = [];
  // Rule 1's gate is `requireAuth(` / `requireTenantCtx(`, so a route that reaches the database and
  // authenticates by a mechanism the gate does not know was not merely not-an-offender — it was
  // invisible. SCIM's HMAC bearer check and the Stripe/Razorpay webhook signature are real
  // authenticators; what they are not is an RLS context, which is why #3303's two SCIM routes could
  // sit on the bare pool unread. The gate stays as it is (only a session read off `app.current_user`
  // can be judged for wrapping), but the routes it steps over are now named.
  const skippedAuthenticators = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (!DB_RE.test(src)) continue;
    if (!AUTH_RE.test(src)) {
      const mechanisms = [...new Set(src.match(AUTH_MECHANISM_RE) ?? [])].sort();
      if (mechanisms.length > 0) {
        skippedAuthenticators.push({ file: relative(root, file).split('\\').join('/'), mechanisms });
      }
      continue;
    }
    const wrapped = WRAP_USED_RE.test(src);
    const hasBareExport = BARE_EXPORT_RE.test(src);
    // Offender if it never actually calls a wrapper, OR it still exports a bare
    // `export async function GET/POST/...` handler (which bypasses the wrapper).
    if (!wrapped || hasBareExport) offenders.push(relative(root, file).split('\\').join('/'));
  }
  skippedAuthenticators.sort((a, b) => a.file.localeCompare(b.file));

  // ── Rule 2 (#3288): anonymous surface, identity table, bare pool ───────────
  const hits = [];
  const seen = new Set();
  for (const file of files) {
    const rel = relative(root, file).split('\\').join('/');
    const text = readFileSync(file, 'utf8');
    if (CONTEXT_ESTABLISHED_RE.test(text)) continue;
    const stripped = stripComments(text).split('\n');
    const { lines, origStart } = fuseChains(stripped);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      BARE_POOL_RE.lastIndex = 0;
      let m;
      while ((m = BARE_POOL_RE.exec(line)) !== null) {
        const at = origStart[i];
        for (const table of identityTablesIn(statementAt(lines, i, m.index))) {
          const key = `${rel}|PREAUTH_UNCONTEXTED_READ|${at}|${table}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push({
            check: 'PREAUTH_UNCONTEXTED_READ',
            file: rel,
            line: at,
            detail: `${table} read or written on the bare pool with no RLS context`,
            source: stripped[at - 1].trim().slice(0, 160),
          });
        }
        if (m.index === BARE_POOL_RE.lastIndex) BARE_POOL_RE.lastIndex += 1;
      }
    }
  }

  // ── Rule 3 (#3290): a process entry point has no request to borrow context from ──
  //
  // Same receiver test as rule 2, and for the same reason: `db.` / `database.` / `pool.` is the pool
  // with every `app.*` GUC cleared, `tx.` is a handle somebody opened a privilege inside of. Lexical
  // nesting is NOT the test, because `withTenantContext(id, user, () => db.select(…))` reads as
  // wrapped and runs on a different connection than the one holding the GUC — it is the bug wearing
  // the fix's clothes. A statement on the bare pool is a statement with no tenant, wherever it sits.
  const TENANT_TABLES = tenantScopedTables(root);
  // Emptiness is not evidence — that is the whole lesson of #3280, and a screen that silently scans
  // zero tables is the same trap wearing a green check. If the schema cannot be read, this rule
  // cannot certify anything, so it says so instead of reporting OK.
  if (entryFiles.length > 0 && TENANT_TABLES.size === 0) {
    return {
      findings: [{
        check: 'ENTRYPOINT_SCREEN_BLIND',
        file: 'drizzle/schema',
        line: 0,
        detail: 'no table in drizzle/schema declared a tenant column — rule 3 cannot tell a safe statement from an invisible one',
      }],
      allowed: 0,
      hits,
      scanned: files.length,
      entryPoints: entryFiles.length,
      offenders,
      skippedAuthenticators,
    };
  }
  for (const { rel, abs } of entryFiles) {
    const stripped = stripComments(readFileSync(abs, 'utf8')).split('\n');
    const { lines, origStart } = fuseChains(stripped);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      BARE_POOL_RE.lastIndex = 0;
      let m;
      while ((m = BARE_POOL_RE.exec(line)) !== null) {
        const at = origStart[i];
        for (const table of tenantTablesIn(statementAt(lines, i, m.index), TENANT_TABLES)) {
          hits.push({
            check: 'ENTRYPOINT_BARE_POOL',
            file: rel,
            line: at,
            detail: `${table} reached from a process entry point on the bare pool — the tenant id in a job payload is a claim until set_config makes it a check`,
            source: stripped[at - 1].trim().slice(0, 160),
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

  return { findings, allowed, hits, scanned: files.length, entryPoints: entryFiles.length, offenders, skippedAuthenticators };
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
  ENTRYPOINT_BARE_POOL       (rule 3) a tenant-scoped table touched through the bare pool by a
                             process entry point (worker.ts, realtime.ts, instrumentation.ts,
                             scripts/cron-scheduler.ts). No request means no pinned connection, so
                             the tenant id in a job payload is only ever a claim until
                             withTenantContext/set_config turns it into a check.
  ENTRYPOINT_SCREEN_BLIND     rule 3 could not read a single tenant-scoped table out of
                             drizzle/schema/** — it refuses to report OK on a screen that is blind.
  BASELINE_STALE             an allowance with no matching site left — shrink-only ratchet
  BASELINE_UNREASONED        an allowance with no reason recorded in "_reasons"
The receiver decides rules 2 and 3: db. is the pool with every app.* GUC cleared, tx. is a transaction
someone opened a privilege inside of. The test is per statement, not per file, because the dead
forgot-password route already contained withTokenIssueContext two lines below the broken SELECT.
The receiver is a property of the statement, not of one source line: a chain whose pool name sits
alone at the end of a line and whose .select( opens on the next is one statement, and rule 2 fuses
the two before matching (#3303 — SCIM's directory read was exactly that shape, and the screen said
nothing).
Rules 2 and 3 screen the anonymous surface. Rule 1's gate is requireAuth(, so a route that
authenticates by a mechanism the gate does not know (a SCIM bearer token, a webhook signature) is
outside what it can certify; every such route is listed on the run's output instead of being silent.
`;

/**
 * Rule 1 cannot judge these, so the run says so. A route behind `verifySCIMToken` or a webhook
 * signature has no session for `withApiRoute` to pin a context to, which means the guard's OK line
 * is about the routes it screened and not about these — printing the list is what stops that OK from
 * being read as a claim over the whole surface (#3303).
 */
function printSkipped(result) {
  if (!result.skippedAuthenticators?.length) return;
  console.log(`  ${result.skippedAuthenticators.length} db-touching route(s) authenticate without requireAuth/requireTenantCtx, so rule 1 cannot judge them:`);
  for (const s of result.skippedAuthenticators) {
    console.log(`    - ${s.file} (${s.mechanisms.join(', ')})`);
  }
}

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
      skippedAuthenticators: result.skippedAuthenticators,
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
    console.log(`[check-rls-route-coverage] OK — ${result.scanned} API routes scanned, all authenticated db-querying handlers are wrapped, no anonymous route touches an identity table on the bare pool, and ${result.entryPoints} process entry point(s) touch no tenant-scoped table on it (${result.allowed} tolerated in the baseline).`);
    printSkipped(result);
    return 0;
  }
  for (const f of result.findings) {
    console.log(`${f.check}\t${f.file}:${f.line}\t${f.detail}`);
    if (f.source) console.log(`\t  ${f.source}`);
  }
  printSkipped(result);
  console.log(`\n${result.findings.length} pre-auth identity statement(s) with no RLS context (#3288). A SELECT on these tables answers zero rows for every input, and a route that returns "ok" when it finds nothing cannot tell that apart from success. Take the read through withAuthLookupContext / withAuthResolutionContext / withOAuthClientLookupContext / withTenantContext, or record it in scripts/rls-preauth-baseline.json with a reason.`);
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main());
}
