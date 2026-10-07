/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Public-route rate-limit guard (#2417, the companion #2383 asked for).
 *
 * Every exported handler under `app/api/public/**` must call `checkRateLimit`
 * with an explicit, unique `action`, before the handler does any database
 * work. Three things this checks that a file-level grep cannot:
 *
 * 1. **Handlers, not files.** #2383 was closed with the claim that the
 *    invariant "currently true except here" — it was not true for three more
 *    handlers, all of them the second leg of a file whose first leg was
 *    already limited. Checking per file hides exactly that.
 * 2. **Ordering.** A limiter placed after the first query throttles the
 *    *response*, not the work. `checkRateLimit` costs a cache round-trip; the
 *    whole point is to reject before the DB is touched.
 * 3. **Action uniqueness.** The bucket key is `v1_rate:${action}:${ip}`, so
 *    two handlers sharing an action share a budget: reading a page would
 *    consume the writes-per-hour allowance of the button on it. #2383 called
 *    this out for CSAT and fixed it there; it is statically checkable, so it
 *    is checked everywhere now.
 *
 * `action` must be written out: `checkRateLimit(request, { max: 10 })`
 * defaults to the action `'api'`, which would silently pool every such route
 * into one shared bucket.
 *
 * Conventions match the rest of the guard family (`check-portal-soft-delete.mts`,
 * `check-route-boundaries.mjs`, `check-audit-baseline.mjs`): pure exported
 * functions so a unit test can plant a violation, `--json`, non-zero exit
 * naming `file:line`, an on-disk baseline with mandatory reasons whose entries
 * are re-verified rather than trusted, and a ratchet-down hint for stale ones.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';

// ── types ────────────────────────────────────────────────────────────────────

export type Handler = {
  file: string;
  verb: string;
  line: number;
  /** handler source, from `export …` to the next `export` (or EOF) */
  body: string;
  /** offset of `checkRateLimit(` within body, -1 when absent */
  limitAt: number;
  /** offset of the first thing that touches the database, -1 when absent */
  dbAt: number;
  /** every `action: '…'` literal passed to a limiter in this handler */
  actions: string[];
};

export type Problem = {
  file: string;
  line: number;
  verb: string;
  kind: 'missing' | 'late' | 'no-action' | 'duplicate-action';
  detail: string;
};

export type BaselineEntry = {
  file: string;
  verb: string;
  reason: string;
  pinnedBy: string;
};

/**
 * A walk that finds almost nothing proves nothing. #2382's guard shipped with
 * the same bug it was written to catch: reading the schema through a module
 * whose re-exports do not survive interop derives 2 tables instead of 200 and
 * prints OK for every file. This floor turns that failure mode into an error.
 */
export const MIN_PUBLIC_HANDLERS = 15;

export function assertHandlersEnumerated(count: number): void {
  if (count < MIN_PUBLIC_HANDLERS) {
    throw new Error(
      `enumerated only ${count} public handler(s); expected at least ${MIN_PUBLIC_HANDLERS} — `
      + 'the route tree was not walked, so this run proves nothing',
    );
  }
}

// ── enumeration ──────────────────────────────────────────────────────────────

const VERB_RE = /^export (?:async )?function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/m;

/**
 * Split a route module into its exported handlers. Slicing to the next
 * top-level `export` is deliberately textual rather than parsed: every helper
 * in these files is module-scope and appears after the handlers or as
 * `function`/`const`, so the slice is a superset of the handler body at worst
 * — which errs toward crediting a limiter, never toward inventing a violation.
 */
export function enumerateHandlers(source: string, file: string): Handler[] {
  const starts: { line: number; verb: string }[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = VERB_RE.exec(lines[i]);
    if (m) starts.push({ line: i, verb: m[1] });
  }

  return starts.map((s, idx) => {
    const next = starts[idx + 1];
    const body = lines.slice(s.line, next ? next.line : lines.length).join('\n');
    const limitAt = body.indexOf('checkRateLimit(');
    const dbAt = firstDbWork(body);
    const actions: string[] = [];
    const actionRe = /checkRateLimit\([^)]*?action:\s*['"]([^'"]+)['"]/g;
    for (let m = actionRe.exec(body); m !== null; m = actionRe.exec(body)) actions.push(m[1]);
    return {
      file,
      verb: s.verb,
      line: s.line + 1,
      body,
      limitAt,
      dbAt,
      actions,
    };
  });
}

/**
 * What counts as "database work". `db.` covers the obvious cases; the portal
 * identity resolvers are included because they *are* queries — a limiter
 * after `resolvePortalIdentity()` has already paid for the request it is
 * trying to refuse.
 */
export function firstDbWork(body: string): number {
  const patterns = [
    /\bdb\.(query|select|execute|update|insert|delete|transaction)\b/,
    /\b(resolvePortalIdentity|resolvePortalContact|getPortalSession)\s*\(/,
  ];
  let best = -1;
  for (const re of patterns) {
    const m = re.exec(body);
    if (!m) continue;
    if (best === -1 || m.index < best) best = m.index;
  }
  return best;
}

// ── findings ─────────────────────────────────────────────────────────────────

export function handlerProblems(handlers: Handler[]): Problem[] {
  const out: Problem[] = [];
  for (const h of handlers) {
    if (h.limitAt === -1) {
      out.push({
        file: h.file, line: h.line, verb: h.verb, kind: 'missing',
        detail: 'no checkRateLimit() call in this handler',
      });
      continue;
    }
    if (h.dbAt !== -1 && h.limitAt > h.dbAt) {
      out.push({
        file: h.file, line: h.line, verb: h.verb, kind: 'late',
        detail: 'checkRateLimit() runs after the handler already touched the database — '
          + 'a throttle that answers a question the DB already paid for',
      });
    }
    if (h.actions.length === 0) {
      out.push({
        file: h.file, line: h.line, verb: h.verb, kind: 'no-action',
        detail: "checkRateLimit() without an explicit action: it defaults to 'api', "
          + "pooling this route into one shared bucket with every other default caller",
      });
    }
  }

  // Bucket collisions. The key is `v1_rate:${action}:${ip}`, so two limiter
  // calls that name the same action read and write one counter wherever they
  // sit — including twice inside a single handler, where the tighter max is the
  // one that actually bites and the looser call is decoration.
  const byAction = new Map<string, Handler[]>();
  for (const h of handlers) {
    for (const a of h.actions) {
      const list = byAction.get(a) ?? [];
      list.push(h);
      byAction.set(a, list);
    }
  }
  for (const [action, list] of byAction) {
    if (list.length < 2) continue;
    for (const h of list) {
      const others = list.filter((o) => o !== h);
      const detail = others.length === 0
        ? `action '${action}' is used twice in this handler — both calls read and increment `
          + 'the same v1_rate counter, so only the tighter max ever applies'
        : `action '${action}' is also used by ${others.map((o) => `${o.file}:${o.line} (${o.verb})`).join(', ')} — `
          + 'those handlers share one v1_rate bucket, so traffic on one starves the other';
      out.push({
        file: h.file, line: h.line, verb: h.verb, kind: 'duplicate-action', detail,
      });
    }
  }
  return out;
}

// ── baseline ─────────────────────────────────────────────────────────────────

export function loadBaseline(path: string): BaselineEntry[] {
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { entries?: BaselineEntry[] };
  return raw.entries ?? [];
}

/**
 * An exemption is re-derived from the tree on every run, never trusted: the
 * file must still exist and still hold the verb it excuses, the reason must be
 * a sentence rather than a word, and the test that pins it must still be
 * there. Anything else is a violation again.
 */
export function verifyEntry(entry: BaselineEntry, root = '.'): string | null {
  const filePath = join(root, entry.file);
  if (!existsSync(filePath)) return `${entry.file} no longer exists`;
  if (!entry.reason || entry.reason.trim().length < 40) {
    return `${entry.file} (${entry.verb}) exemption reason is under 40 characters`;
  }
  if (!entry.pinnedBy || !existsSync(join(root, entry.pinnedBy))) {
    return `${entry.file} (${entry.verb}) exemption names no pinning test at ${entry.pinnedBy}`;
  }
  const source = readFileSync(filePath, 'utf8');
  if (!enumerateHandlers(source, entry.file).some((h) => h.verb === entry.verb)) {
    return `${entry.file} no longer exports a ${entry.verb} handler — the exemption covers nothing`;
  }
  return null;
}

// ── runner ───────────────────────────────────────────────────────────────────

export function walkRouteFiles(dir: string): string[] {
  if (!existsSync(dir)) throw new Error(`${dir} is missing — cannot audit public routes`);
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkRouteFiles(full));
    else if (ent.name === 'route.ts') out.push(full);
  }
  return out.sort();
}

export type RunResult = {
  files: number;
  handlers: number;
  problems: Problem[];
  unused: BaselineEntry[];
  stale: { entry: BaselineEntry; why: string }[];
};

export async function run(
  root = '.',
  opts: { handlers?: Handler[]; baseline?: BaselineEntry[]; dirs?: string[] } = {},
): Promise<RunResult> {
  let handlers = opts.handlers;
  if (!handlers) {
    handlers = [];
    for (const rel of opts.dirs ?? [join('app', 'api', 'public')]) {
      const dir = isAbsolute(rel) ? rel : join(root, rel);
      for (const file of walkRouteFiles(dir)) {
        handlers.push(...enumerateHandlers(readFileSync(file, 'utf8'), relative(root, file).split('\\').join('/')));
      }
    }
    // Only for the real tree: a fixture directory legitimately holds two
    // handlers, and a caller that named its own paths is not being warned
    // about a walk that silently found nothing.
    if (!opts.dirs) assertHandlersEnumerated(handlers.length);
  }

  const baseline = opts.baseline ?? loadBaseline(join(root, 'scripts', 'public-ratelimit-baseline.json'));
  const problems = handlerProblems(handlers);

  const exempt = new Set<string>();
  const stale: { entry: BaselineEntry; why: string }[] = [];
  for (const entry of baseline) {
    const why = verifyEntry(entry, root);
    if (why) { stale.push({ entry, why }); continue; }
    exempt.add(`${entry.file}:${entry.verb}`);
  }
  const filtered = problems.filter(
    (p) => !(p.kind === 'missing' && exempt.has(`${p.file}:${p.verb}`)),
  );

  // An entry whose handler now *does* limit is dead weight that will hide the
  // next regression, so say so — but do not fail, or adding a limiter becomes
  // a two-PR affair.
  const unused = baseline.filter((entry) => {
    const h = handlers.find((x) => x.file === entry.file && x.verb === entry.verb);
    return !!h && h.limitAt !== -1 && h.actions.length > 0;
  });

  return {
    files: new Set(handlers.map((h) => h.file)).size,
    handlers: handlers.length,
    problems: filtered,
    unused,
    stale,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const dirs = args.filter((a) => !a.startsWith('-'));
  const root = '.';
  const result = await run(root, dirs.length ? { dirs } : {});
  const failures = [...result.problems, ...result.stale.map((s) => ({
    file: s.entry.file, line: 0, verb: s.entry.verb, kind: 'stale-baseline' as const,
    detail: `baseline entry is not verifiable: ${s.why}`,
  }))];

  if (json) {
    process.stdout.write(JSON.stringify({ ...result, failures }, null, 2) + '\n');
  } else if (failures.length === 0) {
    process.stdout.write(
      `[check-public-rate-limit] OK — ${result.handlers} public handler(s) across `
      + `${result.files} route file(s), all rate-limited before any database work, `
      + 'each with its own action bucket.\n',
    );
    for (const entry of result.unused) {
      process.stdout.write(
        `  ratchet down: ${entry.file} (${entry.verb}) is now rate-limited — its baseline entry can go.\n`,
      );
    }
  } else {
    process.stdout.write(`[check-public-rate-limit] ${failures.length} violation(s):\n`);
    for (const f of failures) {
      process.stdout.write(`  ${f.file}:${f.line} ${f.verb} — ${f.kind}: ${f.detail}\n`);
    }
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

if (process.argv[1] && process.argv[1].includes('check-public-rate-limit')) {
  main().catch((err: unknown) => {
    process.stderr.write(`[check-public-rate-limit] ${(err as Error).message}\n`);
    process.exit(2);
  });
}
