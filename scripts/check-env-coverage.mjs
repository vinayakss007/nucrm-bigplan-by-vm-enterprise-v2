#!/usr/bin/env node
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Env-coverage screen (#2596).
 *
 * Every name the application reads out of process.env must be visible in
 * .env.example, or be explicitly allowlisted with a written reason in
 * scripts/env-coverage-allowlist.json. The failure mode this removes is
 * silent: an operator deploys, a feature reads FOO and gets undefined, the
 * default path is taken, and nothing anywhere says the deployment is missing
 * a knob. Both directions are checked — undocumented names fail, and
 * allowlist entries that no longer match any read site fail too, so the
 * allowlist cannot accumulate exemptions for code that has since gone.
 *
 * Usage:
 *   node scripts/check-env-coverage.mjs
 *   node scripts/check-env-coverage.mjs --json
 *   node scripts/check-env-coverage.mjs --list-undocumented   # name<TAB>file:line
 *   node scripts/check-env-coverage.mjs --root <dir>          # fixture repo
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : process.cwd());
const AS_JSON = process.argv.includes('--json');
const LIST_ONLY = process.argv.includes('--list-undocumented');

const ENV_FILE = '.env.example';
const ALLOWLIST_FILE = 'scripts/env-coverage-allowlist.json';

/**
 * Directories walked recursively. App code plus operator scripts.
 * Deliberately NOT tests/ or e2e/: those construct their own environment with
 * process.env assignments as fixture setup, and the thing this screen protects
 * is the surface a deployment can configure. A name read only by a test is not
 * an operator's problem.
 */
const SCAN_DIRS = ['app', 'lib', 'components', 'hooks', 'scripts'];

/** Single files at the repo root — Next entrypoints and build config. */
const SCAN_FILES = [
  'worker.ts',
  'proxy.ts',
  'realtime.ts',
  'instrumentation.ts',
  'instrumentation-client.ts',
  'instrumentation.edge.ts',
  'next.config.mjs',
  'drizzle.config.ts',
  'playwright.config.ts',
  'sentry.client.config.ts',
  'sentry.server.config.ts',
  'sentry.edge.config.ts',
  'verify-schema.ts',
  'vitest.setup.ts',
];

const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage', 'dist', '.git', 'backups']);

/**
 * Reads we recognise. `process.env` in its three spellings, plus the typed
 * helpers in lib/env.ts that take the name as a literal first argument —
 * those two helpers are how a name can enter the app without ever appearing
 * next to the string "process.env".
 */
const READ_PATTERNS = [
  /\bprocess\.env\.([A-Z][A-Z0-9_]*)/g,
  /\bprocess\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
  /\b(?:getOptionalEnv|_getRequiredEnv|requireEnv|getEnvValue)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
];

function walkFiles(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkFiles(full, out);
    } else if (entry.isFile() && EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const files = [];
for (const dir of SCAN_DIRS) {
  const full = path.join(ROOT, dir);
  if (existsSync(full) && statSync(full).isDirectory()) walkFiles(full, files);
}
for (const file of SCAN_FILES) {
  const full = path.join(ROOT, file);
  if (existsSync(full) && statSync(full).isFile()) files.push(full);
}

/**
 * Remove comments before matching, so a name that only appears in prose
 * ("operators sometimes set BACKUP_DIR") is not counted as a read site.
 * Comment markers inside a string are not comment starts, so this walks the
 * text as a scanner rather than a regex: single/double quotes, template
 * literals with their `${ }` expressions, line comments and block comments.
 * Everything that is not a comment is emitted verbatim — including the quote
 * characters, since `process.env['X']` only matches with its quotes present —
 * and newlines are always emitted so reported line numbers stay true.
 */
function stripComments(text) {
  const out = [];
  // Frames are the literal quote character that opened them, or 'tplExpr' for
  // the inside of a `${ }` substitution, so closing needs no extra bookkeeping.
  const stack = [];
  let i = 0;
  while (i < text.length) {
    const frame = stack[stack.length - 1];
    const ch = text[i];
    const next = text[i + 1];

    if (!frame || frame === 'code' || frame === 'tplExpr') {
      if (ch === '/' && next === '/') {
        while (i < text.length && text[i] !== '\n') i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        i += 2;
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
          if (text[i] === '\n') out.push('\n');
          i++;
        }
        i += 2;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { stack.push(ch); out.push(ch); i++; continue; }
      if (frame === 'tplExpr' && ch === '}') { stack.pop(); out.push(ch); i++; continue; }
      out.push(ch);
      i++;
      continue;
    }

    if (frame === '`') {
      if (ch === '\\') { out.push(ch, next ?? ''); i += 2; continue; }
      if (ch === '$' && next === '{') { stack.push('tplExpr'); out.push('${'); i += 2; continue; }
      if (ch === '`') stack.pop();
      out.push(ch);
      i++;
      continue;
    }

    // single- or double-quoted string
    if (ch === '\\') { out.push(ch, next ?? ''); i += 2; continue; }
    if (ch === frame || ch === '\n') stack.pop();
    out.push(ch);
    i++;
    continue;
  }
  return out.join('');
}

/** name -> [{ file, line }] */
const reads = new Map();
for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const text = stripComments(readFileSync(file, 'utf8'));
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const pattern of READ_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(lines[i])) !== null) {
        const name = match[1];
        if (!reads.has(name)) reads.set(name, []);
        reads.get(name).push({ file: rel, line: i + 1 });
      }
    }
  }
}

/**
 * Names .env.example covers. A commented-out `# NAME=` counts: it is present,
 * explained and one keystroke from enabled, which is exactly the state
 * COOKIE_SECURE is in. Requires `=` after the name so prose like
 * "TELEGRAM_BOT_TOKEN is the secret" does not qualify.
 */
const documented = new Set();
const envPath = path.join(ROOT, ENV_FILE);
if (!existsSync(envPath)) {
  console.error(`✖ ${ENV_FILE} not found at ${ROOT}`);
  process.exit(1);
}
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const match = line.match(/^\s*(?:#{1,2}\s*)?(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
  if (match) documented.add(match[1]);
}

const allowlistPath = path.join(ROOT, ALLOWLIST_FILE);
let allowlist = [];
if (existsSync(allowlistPath)) {
  const parsed = JSON.parse(readFileSync(allowlistPath, 'utf8'));
  allowlist = Array.isArray(parsed.entries) ? parsed.entries : [];
}
const allowed = new Map(allowlist.map((entry) => [entry.name, entry]));

const undocumented = [];
for (const [name, sites] of [...reads].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (documented.has(name) || allowed.has(name)) continue;
  undocumented.push({ name, sites });
}

// An exemption whose read site is gone is worse than no exemption: it keeps
// the name permanently invisible to this screen while proving nothing.
const stale = allowlist
  .filter((entry) => !reads.has(entry.name))
  .map((entry) => entry.name);

const summary = {
  filesScanned: files.length,
  namesRead: reads.size,
  namesDocumented: documented.size,
  namesAllowlisted: allowed.size,
  undocumented: undocumented.map((entry) => entry.name),
  staleAllowlistEntries: stale,
};

if (LIST_ONLY) {
  for (const entry of undocumented) {
    const first = entry.sites[0];
    process.stdout.write(`${entry.name}\t${first.file}:${first.line}\n`);
  }
  process.exit(undocumented.length > 0 ? 1 : 0);
}

if (AS_JSON) {
  process.stdout.write(JSON.stringify({ ...summary, undocumentedDetail: undocumented }, null, 2) + '\n');
  process.exit(undocumented.length > 0 || stale.length > 0 ? 1 : 0);
}

console.log(`scanned        ${summary.filesScanned} files`);
console.log(`names read     ${summary.namesRead}`);
console.log(`documented     ${summary.namesDocumented} (${ENV_FILE})`);
console.log(`allowlisted    ${summary.namesAllowlisted} (${ALLOWLIST_FILE})`);
console.log('');

if (undocumented.length === 0 && stale.length === 0) {
  console.log('OK — every environment variable the code reads is documented or allowlisted.');
  process.exit(0);
}

if (undocumented.length > 0) {
  console.log(`✖ ${undocumented.length} variable(s) are read by the code but appear in neither ${ENV_FILE} nor the allowlist:`);
  for (const entry of undocumented) {
    console.log(`    ${entry.name}`);
    for (const site of entry.sites.slice(0, 2)) {
      console.log(`        ${site.file}:${site.line}`);
    }
  }
  console.log('');
  console.log(`  Fix: add them to ${ENV_FILE} with the value used when unset,`);
  console.log(`  or give them a written reason in ${ALLOWLIST_FILE}.`);
}

for (const name of stale) {
  console.log(`✖ allowlist entry "${name}" matches no read site any more — remove it.`);
}

process.exit(1);
