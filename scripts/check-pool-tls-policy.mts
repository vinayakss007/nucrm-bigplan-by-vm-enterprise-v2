/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * One TLS policy at every `new Pool(` (#3381).
 *
 * `pg` does not read `?sslmode=` from a connection string. That parameter is
 * libpq's — what `psql`/`pg_dump`/`pg_restore` speak, reached in this repo through
 * `pgLibpqEnv()` copying it into `PGSSLMODE`. A node-pg pool has exactly one TLS
 * channel: the `ssl` option. Omit it and the driver connects in plaintext whatever
 * the URL says.
 *
 * `lib/db/ssl-config.ts` fixed the disagreement by policy; #3382 took it to
 * backup-verify's own pools and #3381 to the last 11 sites. This screen is what keeps
 * the fix from re-drifting. It walks every non-test `.ts`/`.mts`/`.tsx` source,
 * brace-matches the argument of each `new Pool(`, and requires a TLS entry.
 *
 * Two decisions, because both are the kind a grep gets wrong:
 *
 * 1. **The option's name is read, never its value.** `scripts/dr.ts`, `preflight.ts` and
 *    `bootstrap-test-db.ts` pass `ssl` as a variable, and `new Pool({ connectionString,
 *    ssl })` passes it as shorthand; all three satisfy the screen, and so does `ssl:`
 *    with a value the screen cannot see the shape of.
 * 2. **A `PoolConfig`-variable argument is proved, not assumed.** `lib/db/pool.ts` builds
 *    `const poolConfig: PoolConfig = { … }` and calls `new Pool(poolConfig)`. Counting
 *    that as covered is how the next refactor renames the variable, or moves it to a
 *    helper in another file, and the screen certifies a TLS policy it never saw. So an
 *    identifier must resolve, in the same file, to a literal that itself carries the
 *    entry — and a spread (`{ ...cfg }`) is unprovable, because its contribution is
 *    invisible here.
 *
 * Findings are grouped by **file**, and there is no baseline: #3381 landed its 11 sites
 * in the same change as this screen, so a new site has to answer in code rather than in
 * a JSON exemption.
 *
 * Usage: npx tsx scripts/check-pool-tls-policy.mts [--json] [source-root…]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SOURCE_DIRS = ['app', 'lib', 'scripts', 'components', 'deploy'];
const SOURCE_EXT = /\.(ts|mts|tsx)$/;

export type PoolSite = {
  file: string;
  line: number;
  /** the argument text exactly as written, trimmed */
  arg: string;
  /** how the argument was understood */
  form: 'literal' | 'identifier' | 'empty' | 'unmatched';
  hasTls: boolean;
  /** why `hasTls` was decided, for --json */
  detail: string;
};

const OPENERS: Record<string, string> = { '{': '}', '(': ')', '[': ']' };

/** Comments blanked out, offsets and line breaks preserved, strings untouched. */
export function maskComments(text: string): string {
  const out = text.split('');
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote || (c === '\n' && quote !== '`')) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c !== '/') continue;
    if (text[i + 1] === '/') {
      let j = i;
      while (j < text.length && text[j] !== '\n') out[j++] = ' ';
      i = j - 1;
    } else if (text[i + 1] === '*') {
      let j = i;
      while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) { if (text[j] !== '\n') out[j] = ' '; j++; }
      out[j++] = ' '; out[j++] = ' ';
      i = j - 1;
    }
  }
  return out.join('');
}


/** As above, and the inside of every string blanked too — so a message that
 *  *quotes* `new Pool(` is not mistaken for a call site. Offsets are preserved. */
export function blankCode(text: string): string {
  const masked = maskComments(text);
  const out = masked.split('');
  let quote = '';
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (quote) {
      if (c === '\\') { out[i++] = ' '; out[i] = ' '; continue; }
      if (c === quote || (c === '\n' && quote !== '`')) quote = '';
      else if (c !== '\n') out[i] = ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
  }
  return out.join('');
}

/** Index of the delimiter closing the one at `open`, skipping strings and comments. */
function matchCloser(text: string, open: number): number {
  const close = OPENERS[text[open]];
  if (!close) return -1;
  let depth = 0;
  let quote = '';
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote || (c === '\n' && quote !== '`')) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) return -1; continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2) + 1; if (i < 1) return -1; continue; }
    if (c === text[open] && OPENERS[c]) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Strip one wrapping quote pair from a declared key. Written with charCodes so this file has no unbalanced quote of its own. */
function unkey(k: string): string {
  const first = k.charCodeAt(0);
  if (first !== 34 && first !== 39 && first !== 96) return k;
  return k.charCodeAt(k.length - 1) === first ? k.slice(1, -1) : k;
}

/** Property names declared at the top level of an object literal body. */
function topLevelKeys(body: string): { keys: string[]; spread: boolean } {
  const keys: string[] = [];
  let spread = false;
  let depth = 0;
  let quote = '';
  let token = '';
  let sawColon = false;
  const name = () => {
    const t = unkey(token.trim());
    token = '';
    if (!t) return;
    if (t.startsWith('...')) spread = true;
    else if (/^[A-Za-z_$][\w$]*$/.test(t)) keys.push(t);
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      token += c;
      if (c === '\\') { token += body[++i] ?? ''; continue; }
      if (c === quote || (c === '\n' && quote !== '`')) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; token += c; continue; }
    if (c === '{' || c === '(' || c === '[') { depth++; token += c; continue; }
    if (c === '}' || c === ')' || c === ']') { depth--; token += c; continue; }
    if (depth > 0) { token += c; continue; }
    // A bare identifier before `:` is a key; one after it is that key's value, and
    // a bare identifier with no `:` in its segment at all is shorthand — `{ ssl }` —
    // which is a name too. Keeping the two apart is what stops `{ defaults: ssl }`
    // from reading as an `ssl` entry.
    if (c === ',') { if (sawColon) token = ''; else name(); sawColon = false; continue; }
    if (c === ':') { name(); sawColon = true; continue; }
    token += c;
  }
  if (!sawColon) name();
  return { keys, spread };
}

/** The object literal assigned to `const|let|var <name> = {`, in this same file. */
function literalFor(source: string, name: string): string | null {
  const re = new RegExp(`(?:const|let|var)\\s+${name}\\s*(:[^=]*?)?=\\s*\\{`);
  const m = re.exec(source);
  if (!m) return null;
  const open = source.indexOf('{', m.index + m[0].length - 1);
  const close = matchCloser(source, open);
  return close < 0 ? null : source.slice(open + 1, close);
}

function scanSource(file: string, raw: string): PoolSite[] {
  const sites: PoolSite[] = [];
  const source = maskComments(raw);
  // Sites are *found* in the string-blanked copy, then *read* in the comment-blanked
  // one, so a screen message quoting `new Pool(` cannot register as a pool site while
  // a quoted option key (`{ 'ssl': … }`) is still visible to the reader.
  const found = blankCode(raw);
  const lineAt = (index: number) => source.slice(0, index).split('\n').length;
  for (const m of found.matchAll(/new\s+Pool\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchCloser(source, open);
    if (close < 0) {
      sites.push({ file, line: lineAt(m.index), arg: '', form: 'unmatched', hasTls: false, detail: 'unbalanced parentheses after new Pool(' });
      continue;
    }
    const arg = source.slice(open + 1, close).trim();
    if (arg === '') {
      sites.push({ file, line: lineAt(m.index), arg, form: 'empty', hasTls: false, detail: 'no options object at all' });
      continue;
    }
    let body: string | null = null;
    let form: PoolSite['form'] = 'literal';
    let detail = '';
    if (arg.startsWith('{')) {
      body = arg.slice(1, arg.lastIndexOf('}'));
    } else if (/^[A-Za-z_$][\w$]*$/.test(arg)) {
      form = 'identifier';
      body = literalFor(source, arg);
      detail = body === null ? `new Pool(${arg}) — ${arg} has no object literal in this file to read` : '';
    } else {
      form = 'unmatched';
      detail = 'the argument is neither an object literal nor a single identifier';
    }
    if (body === null) {
      sites.push({ file, line: lineAt(m.index), arg, form, hasTls: false, detail });
      continue;
    }
    const { keys, spread } = topLevelKeys(body);
    const hasTls = !spread && keys.includes('ssl');
    sites.push({
      file,
      line: lineAt(m.index),
      arg,
      form,
      hasTls,
      detail: spread ? 'a spread contributes unknown options' : hasTls ? 'ssl entry found' : `no ssl entry (keys: ${keys.join(', ') || 'none'})`,
    });
  }
  return sites;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, acc);
    else if (SOURCE_EXT.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) acc.push(path);
  }
  return acc;
}

export function screen(root: string, dirs: string[] = SOURCE_DIRS): PoolSite[] {
  const sites: PoolSite[] = [];
  for (const dir of dirs) {
    try { readdirSync(join(root, dir)); } catch { continue; }
    for (const file of walk(join(root, dir))) {
      sites.push(...scanSource(relative(root, file).replace(/\\/g, '/'), readFileSync(file, 'utf8')));
    }
  }
  return sites;
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const json = argv.includes('--json');
  const roots = argv.filter((a) => !a.startsWith('--'));
  const root = roots[0] ?? '.';
  const sites = screen(root);
  const missing = sites.filter((s) => !s.hasTls);
  const byFile = new Map<string, PoolSite[]>();
  for (const site of missing) byFile.set(site.file, [...(byFile.get(site.file) ?? []), site]);

  if (json) {
    process.stdout.write(`${JSON.stringify({
      poolSites: sites.length,
      withoutTlsPolicy: missing.map((s) => ({ file: s.file, line: s.line, form: s.form, detail: s.detail })),
    })}\n`);
  } else if (byFile.size > 0) {
    process.stderr.write(`\n✖ pg.Pool sites with no TLS policy (#3381): ${missing.length} in ${byFile.size} file(s)\n`);
    for (const [file, list] of [...byFile].sort()) {
      process.stderr.write(`  - ${file}: ${list.length} site(s) — ${list.map((s) => s.detail).join('; ')}\n`);
    }
    process.stderr.write(
      '\n  `ssl` is a node-pg option, not a URL parameter: add `ssl: pgSslConfig()` to the pool\n' +
        '  options (or to the PoolConfig literal the pool is built from). A pool built without it\n' +
        '  connects in plaintext even when DATABASE_URL says sslmode=require.\n\n',
    );
  } else {
    process.stdout.write(
      `[check-pool-tls-policy] OK — ${sites.length} pg.Pool site(s) across ` +
        `${new Set(sites.map((s) => s.file)).size} file(s), every one declares a TLS entry.\n`,
    );
  }
  return byFile.size > 0 ? 1 : 0;
}

if (process.argv[1]?.includes('check-pool-tls-policy')) process.exit(main());
