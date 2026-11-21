/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3773 — ratchet client/server payload-contract mismatches.
 *
 * 12 of the 19 bugs filed on 2026-11-21 were one class: a client read a field
 * the matching API route never returns (`contacts` vs `data`, snake_case vs
 * camelCase), or sent a field its Zod schema strips. #655 and #2289 tried to
 * fix the envelope once and were closed; the class recurred. This guard pins
 * the current surface in an exact ledger so it can only SHRINK: a new client
 * read that no matching route declares fails CI, and a fixed mismatch must
 * drop its ledger entry. Mirrors guard:api-envelope's ratchet shape.
 *
 * Usage:
 *   node scripts/check-contract-shape.mjs            # verify
 *   node scripts/check-contract-shape.mjs --update    # regenerate the ledger
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const ROOT = join(import.meta.dirname, '..');
export const LEDGER = 'scripts/contract-shape-ledger.json';

/** Fields that are part of the canonical envelope or ordinary JS plumbing. */
const IGNORED = new Set([
  'data', 'total', 'unread', 'limit', 'offset', 'ok', 'error', 'message', 'code',
  'success', 'result', 'meta', 'pagination', 'count', 'items', 'rows',
  'map', 'filter', 'length', 'then', 'catch', 'finally', 'has', 'get', 'set',
  'keys', 'values', 'entries', 'toString', 'includes', 'find', 'some', 'every',
  'reduce', 'sort', 'slice', 'concat', 'join', 'push', 'pop', 'shift', 'unshift',
  'indexOf', 'forEach', 'toLowerCase', 'toUpperCase', 'trim', 'split', 'replace',
  'match', 'test', 'charAt', 'substr', 'substring', 'startsWith', 'endsWith',
  'padStart', 'padEnd', 'at', 'flat', 'flatMap', 'findIndex', 'constructor',
  'valueOf', 'name', 'id', 'status', 'type', 'title', 'body', 'createdAt',
  'updatedAt', 'deletedAt', 'userId', 'tenantId',
]);

/** Top-level keys of every `json({ ... })` object literal in a route file. */
export function responseKeys(src) {
  const keys = new Set();
  const re = /\bjson\s*\(\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0, quote = null, close = -1;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === '\\') { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
      if (c === '{' || c === '[' || c === '(') depth++;
      else if (c === '}' || c === ']' || c === ')') {
        depth--;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close < 0) continue;
    const body = src.slice(open + 1, close);
    depth = 0; quote = null;
    for (let j = 0; j < body.length; j++) {
      const c = body[j];
      if (quote) {
        if (c === '\\') { j++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
      if (c === '{' || c === '[' || c === '(') depth++;
      else if (c === '}' || c === ']' || c === ')') depth--;
      if (depth === 0) {
        const km = /^([A-Za-z_$][\w$]*)\s*:/.exec(body.slice(j));
        if (km) { keys.add(km[1]); j += km[0].length - 1; }
      }
    }
  }
  return keys;
}

/** Resolve an API URL to a tracked route file, tolerating dynamic segments. */
export function routeForUrl(url, routeFiles) {
  const path = (url.split('?')[0] || '').replace(/\/+$/, '');
  if (!path.startsWith('/api')) return null;
  const segs = path.split('/').filter(Boolean);
  for (const rf of routeFiles) {
    const apiSegs = rf.replace(/\/route\.ts$/, '').split(/[/\\]/).filter(Boolean).slice(1);
    if (apiSegs.length !== segs.length) continue;
    let ok = true;
    for (let i = 0; i < segs.length; i++) {
      if (/^\[.*\]$/.test(apiSegs[i])) continue;
      if (apiSegs[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) return rf;
  }
  return null;
}

export function useApiQueryVars(src) {
  const vars = new Set();
  const re = /const\s*\{([^}]*)\}\s*=\s*useApiQuery\b/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    for (const part of m[1].split(',')) {
      const p = part.trim();
      const alias = /^data\s*:\s*([A-Za-z_$][\w$]*)/.exec(p);
      if (alias) vars.add(alias[1]);
      else if (p === 'data') vars.add('data');
    }
  }
  // `const result = useApiQuery(...)` → `result.data?.x`
  const whole = /const\s+([A-Za-z_$][\w$]*)\s*=\s*useApiQuery\b/g;
  while ((m = whole.exec(src)) !== null) vars.add(`${m[1]}.data`);
  return vars;
}

export function apiUrls(src) {
  const urls = new Set();
  const re = /useApiQuery\s*(?:<[^>]*>)?\s*\([^,]+,\s*['"`]([^'"`]+)['"`]/g;
  let m;
  while ((m = re.exec(src)) !== null) urls.add(m[1]);
  return urls;
}

export function readKeys(src, vars) {
  const keys = new Set();
  for (const v of vars) {
    const prefix = v.includes('.') ? v.replace(/\./g, '\\.') : v;
    const re = new RegExp(`\\b${prefix}\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)`, 'g');
    let m;
    while ((m = re.exec(src)) !== null) keys.add(m[1]);
  }
  return keys;
}

/** Findings for one client file: reads no matching route declares. */
export function contractFindings(src, routeFiles) {
  const urls = [...apiUrls(src)];
  const declared = new Set();
  for (const url of urls) {
    const rf = routeForUrl(url, routeFiles);
    if (!rf) continue;
    for (const k of responseKeys(readFileSync(join(ROOT, rf), 'utf8'))) declared.add(k);
  }
  const keys = readKeys(src, useApiQueryVars(src));
  return [...keys].filter((k) => !IGNORED.has(k) && !declared.has(k)).sort();
}

export function checkContractShape(files, readFile, entries, routeFiles) {
  const problems = [];
  const seen = new Set();
  for (const file of files) {
    const found = contractFindings(readFile(file), routeFiles);
    if (found.length === 0) continue;
    seen.add(file);
    const pinned = entries[file];
    if (pinned === undefined) {
      problems.push(`${file} reads ${found.join(', ')} with no matching response key — use the API's real field names, or update ${LEDGER} with review (#3773).`);
    } else if (JSON.stringify(found) !== JSON.stringify(pinned)) {
      problems.push(`${file} contract reads changed from [${pinned.join(', ')}] to [${found.join(', ')}] — the surface may only shrink; re-measure with review (#3773).`);
    }
  }
  for (const file of Object.keys(entries)) {
    if (!seen.has(file)) {
      problems.push(`${file} is pinned in ${LEDGER} but no longer has contract findings — remove the stale entry to ratchet down (#3773).`);
    }
  }
  return problems;
}

function main() {
  const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  const routeFiles = git(['ls-files', '--', 'app/api/**/route.ts']).split('\n').map((s) => s.trim()).filter(Boolean).sort();
  const files = git(['ls-files', '--', 'app/**/*.tsx', 'components/**/*.tsx']).split('\n').map((s) => s.trim()).filter(Boolean).sort();
  const read = (p) => readFileSync(join(ROOT, p), 'utf8');
  const ledgerPath = join(ROOT, LEDGER);

  if (process.argv.includes('--update')) {
    const entries = {};
    for (const file of files) {
      const found = contractFindings(read(file), routeFiles);
      if (found.length > 0) entries[relative(ROOT, file).split(sep).join('/')] = found;
    }
    writeFileSync(ledgerPath, `${JSON.stringify(
      Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))), null, 2,
    )}\n`);
    console.log(`[check-contract-shape] ledger updated: ${Object.keys(entries).length} client file(s) with pinned findings.`);
    return;
  }

  const entries = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const problems = checkContractShape(files, read, entries, routeFiles);
  if (problems.length > 0) {
    console.error(`\u2716 contract-shape guard failed (#3773):\n\n  ${problems.join('\n  ')}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`[check-contract-shape] OK — ${files.length} client file(s) scanned against ${routeFiles.length} route(s); ${Object.keys(entries).length} pinned finding(s), no new mismatches.`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
