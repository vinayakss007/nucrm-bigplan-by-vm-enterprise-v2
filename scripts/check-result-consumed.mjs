/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3408 PR-5A — a Result is a value, not a suggestion.
 *
 * A domain helper that declares `Result<T,E>` (or `Promise<Result<T,E>>`) has
 * made failure a value the caller must read. Discarding it — `await f()` on its
 * own line — puts the code back in the pre-#3408 world where "no data" and
 * "the request failed" look identical in the UI.
 *
 * This screen discovers every exported helper with a declared `Result` return
 * type under `app/`, `lib/` and `scripts/`, then requires each call site to
 * bind, return, pass or branch on the result. It is the same shape as
 * `scripts/check-email-result-consumed.mjs` (which it reuses for paren
 * matching) and rides `npm run test:unit` through its unit tests rather than
 * adding a `guard:*` alias to the contested guard census.
 *
 * Usage (from the repo root): node scripts/check-result-consumed.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { matchParen } from './check-email-result-consumed.mjs';

export const SCAN_DIRS = ['app', 'lib', 'scripts'];

const ALIAS_RE =
  /(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Promise\s*<\s*)?Result\s*</g;

/** Local names for Result (e.g. `type CheckoutPlanResolution = Result<S,F>`). */
export function findResultAliases(source) {
  const names = new Set();
  ALIAS_RE.lastIndex = 0;
  let m;
  while ((m = ALIAS_RE.exec(source)) !== null) names.add(m[1]);
  return [...names];
}

function functionRes(aliases) {
  const ret = aliases.length
    ? `(?:Result\\s*<|\\b(?:${aliases.join('|')})\\b)`
    : 'Result\\s*<';
  return [
    new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+([A-Za-z_$][\\w$]*)\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)\\s*:\\s*(?:Promise\\s*<\\s*)?${ret}`, 'g'),
    new RegExp(`(?:export\\s+)?const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*:\\s*(?:Promise\\s*<\\s*)?${ret}`, 'g'),
  ];
}

/** Names of exported helpers in this source that declare a `Result` return. */
export function findResultFunctions(source, aliases = []) {
  const names = new Set();
  for (const re of functionRes(aliases)) {
    let m;
    while ((m = re.exec(source)) !== null) names.add(m[1]);
  }
  return [...names];
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

/** Call sites of the discovered helpers, excluding definitions/imports/comments. */
export function findCalls(source, names) {
  const found = [];
  for (const name of names) {
    const re = new RegExp(`(?<![\\w.$])\\b${name}\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(source)) !== null) {
      const lineStart = source.lastIndexOf('\n', m.index) + 1;
      const lineEnd = source.indexOf('\n', m.index);
      const line = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
      const before = line.slice(0, m.index - lineStart);
      if (/\b(?:function|interface|type|class)\s*$/.test(before)) continue;
      if (/^\s*(?:export\s+)?import\b/.test(line)) continue;
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line) || before.includes('//')) continue;
      const openIndex = source.indexOf('(', m.index);
      found.push({ name, index: m.index, lineStart, openIndex, line: lineNumber(source, m.index) });
      re.lastIndex = openIndex;
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * Classify the calls in one source file. A finding is returned for every call
 * whose value is provably dropped (or whose shape the screen cannot read).
 */
export function classifySource(source, names, path = '<source>') {
  const findings = [];
  const calls = findCalls(source, names);
  for (const call of calls) {
    const open = source.indexOf('(', call.index);
    const close = matchParen(source, open);
    if (close === -1) {
      findings.push({ path, line: call.line, name: call.name, kind: 'unparsable',
        why: `${call.name}( … has no matching ) so the screen cannot prove the result is read` });
      continue;
    }
    const head = source.slice(call.lineStart, call.index).trimEnd().replace(/\b(?:await|yield)\s*$/, '').trim();
    const after = source.slice(close + 1, close + 80).trimStart();

    const bound = /=\s*$/.test(head);
    const returned = /\breturn\b\s*$/.test(head);
    const argument = /[(,[]\s*$/.test(head);
    const arrowBody = /=>\s*$/.test(head);
    const chainedThen = /^\.then\s*\(/.test(after);
    // `if ((await f()).ok)` / `(await f()).data` — strip wrappers, then read
    // the discriminated field directly off the call.
    const branched = /^\.(?:ok|error|data)\b/.test(after.replace(/^[)!]+\s*/, ''));

    if (bound || returned || argument || arrowBody || chainedThen || branched) continue;
    findings.push({ path, line: call.line, name: call.name, kind: 'unbound',
      why: `the Result from ${call.name}() is discarded — bind it, return it, or branch on .ok/.error (#3408)` });
  }
  return { findings, checked: calls.length };
}

/**
 * Only screen calls to names IMPORTED from a module that actually declares a
 * Result. Scripts have their own local `ok()`/`fail()` helpers that have nothing
 * to do with this contract — a name-only screen would flag all of them.
 */
function importedResultNames(source, rel, names, resultModules) {
  const out = new Set();
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const spec = m[2];
    let base = null;
    if (spec.startsWith('@/')) base = spec.slice(2);
    else if (spec.startsWith('.')) base = normalize(join(dirname(rel), spec)).replace(/\\/g, '/');
    if (base === null || !resultModules.has(base)) continue;
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
      if (name && names.has(name)) out.add(name);
    }
  }
  return [...out];
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(?:ts|tsx)$/.test(e.name) && !/\.test\.[tm]sx?$/.test(e.name)) yield p;
  }
}

/** Scan the repo for discarded Results. */
export function run(root = process.cwd()) {
  // Two passes: first learn the helper names, then check their call sites.
  // A name declared in one file and called in another is the common case.
  const sources = [];
  const aliases = new Set();
  const resultModules = new Set();
  let filesScanned = 0;
  for (const dir of SCAN_DIRS) {
    for (const file of walk(resolve(root, dir))) {
      const source = readFileSync(file, 'utf8');
      const rel = file.slice(resolve(root).length + 1).replace(/\\/g, '/');
      const aliasesHere = findResultAliases(source);
      const funcsHere = findResultFunctions(source);
      sources.push({ source, rel, aliasesHere, funcsHere });
      filesScanned += 1;
      for (const name of aliasesHere) aliases.add(name);
      if (aliasesHere.length || funcsHere.length) {
        resultModules.add(rel.replace(/\.(?:ts|tsx)$/, ''));
      }
    }
  }
  const names = new Set();
  const aliasList = [...aliases];
  for (const { source, funcsHere } of sources) {
    if (funcsHere.length) {
      for (const name of funcsHere) names.add(name);
    } else if (aliasList.some((a) => source.includes(a))) {
      // Alias may be declared in a file scanned earlier; re-check just these.
      for (const name of findResultFunctions(source, aliasList)) names.add(name);
    }
  }

  const findings = [];
  let checked = 0;
  for (const { source, rel } of sources) {
    const localNames = importedResultNames(source, rel, names, resultModules);
    if (localNames.length === 0) continue;
    const r = classifySource(source, localNames, rel);
    checked += r.checked;
    findings.push(...r.findings);
  }
  return { filesScanned, helpers: [...names], checked, findings };
}

function main() {
  const { filesScanned, helpers, checked, findings } = run();
  if (findings.length > 0) {
    console.error(
      `\n✖ a Result is discarded (#3408):\n\n` +
        findings.map((f) => `    - ${f.path}:${f.line}  ${f.why}`).join('\n') + '\n',
    );
    process.exit(1);
  }
  console.log(
    `[check-result-consumed] OK — ${checked} call(s) to ${helpers.length} Result-returning helper(s) `
      + `across ${filesScanned} file(s) under app/, lib/, scripts/ bind, return or branch on their result (#3408).`,
  );
}

// Run only when invoked as a CLI, so unit tests can import the pure logic.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
