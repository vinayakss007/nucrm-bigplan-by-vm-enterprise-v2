/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * A sent email is a result, not a hope (#3408).
 *
 * `sendEmail()` never rejects. Every provider path — Resend refused and no SMTP
 * fallback, SMTP refused, no provider configured at all — resolves
 * `{ success: false, error }` (lib/email/service.ts:249-299). So the two shapes
 * that look like handling are not:
 *
 *   await sendEmail({...}).catch((e) => logError(e))   // the catch cannot fire
 *   await alertSuperAdmin(...)                          // the value goes nowhere
 *
 * Both read as "we dealt with it" and both drop a provider rejection on the
 * floor. That is not hypothetical: #2998, #3045 and #3110 are three separate
 * visits to this same hole in three separate call sites, and the operator alert
 * for a broken backup (`alertSuperAdmin`) was the last one still standing — a
 * channel whose entire job is to page a human about a failure, silent about its
 * own failure.
 *
 * This screen makes the shape impossible to re-add. For every call to
 * `sendEmail` / `alertSuperAdmin` / `sendAlertEmail` under `app/`, `lib/` and
 * `scripts/` it requires the result to be BOUND (`const r = await …`),
 * RETURNED (`return …`), or CHECKED in a `.then((r) => …)` callback, and it
 * rejects a `.catch(` chained onto the call as a handler for a throw that
 * cannot happen.
 *
 * Usage (from the repo root): node scripts/check-email-result-consumed.mjs
 *
 * The pure layer (`classifySource`) is exported and takes the file contents, so
 * the unit tests can plant both a bare `await` and a dead `.catch()` in a
 * fixture and prove the screen fires — the convention this repo's guards all
 * keep, because a screen nobody can arm is a screen nobody trusts.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SEND_FNS = ['sendEmail', 'alertSuperAdmin', 'sendAlertEmail'];
export const SCAN_DIRS = ['app', 'lib', 'scripts'];

/**
 * Walk the characters of a statement from the call's opening paren to its
 * match, ignoring parens inside strings, template literals and `${}` holes the
 * way a parser would. These call sites are mostly multi-line HTML template
 * literals — `rgba(0,0,0,.5)`, `(sizeBytes/1024)` — so a naive counter stops
 * matching at the first unbalanced paren inside a string and reports the wrong
 * end of the call.
 */
export function matchParen(source, openIndex) {
  let depth = 0;
  let i = openIndex;
  // `'`, `"`, and backtick regions each need their own frame: a `}` inside a
  // template's `${ … }` hole returns to the template, not to the enclosing code.
  const frames = [];
  let state = 'code';
  let quote = '';
  while (i < source.length) {
    const c = source[i];
    const prev = i > 0 ? source[i - 1] : '';
    const escaped = prev === '\\';
    if (state === 'code') {
      if (c === '`') { state = 'template'; frames.push('template'); }
      else if (c === '"' || c === "'") { state = 'string'; quote = c; frames.push('string'); }
      else if (c === '/' && source[i + 1] === '/') {
        while (i < source.length && source[i] !== '\n') i += 1;
        continue;
      }
      else if (c === '(') depth += 1;
      else if (c === ')') {
        depth -= 1;
        if (depth === 0) return i;
        if (depth < 0) return -1;
      }
      else if (c === '}' && frames[frames.length - 1] === 'template-hole') {
        frames.pop();
        state = 'template';
      }
      else if (c === '$' && source[i + 1] === '{') {
        frames.push('template-hole');
        i += 1;
      }
    } else if (state === 'string') {
      if (c === quote && !escaped) { state = 'code'; frames.pop(); }
    } else if (state === 'template') {
      if (c === '`' && !escaped) { state = 'code'; frames.pop(); }
      else if (c === '$' && source[i + 1] === '{' && !escaped) {
        state = 'code';
        frames.push('template-hole');
        i += 1;
      }
    }
    i += 1;
  }
  return -1;
}

/** Every call site of one of the send helpers, with the line it starts on. */
export function findCalls(source) {
  const found = [];
  for (const name of SEND_FNS) {
    const re = new RegExp(`(?<![\\w.$])\\b${name}\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(source)) !== null) {
      const lineStart = source.lastIndexOf('\n', m.index) + 1;
      const lineEnd = source.indexOf('\n', m.index);
      const line = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
      const before = line.slice(0, m.index - lineStart);
      // Not a call: a definition (`export async function sendEmail(`), an import
      // specifier, a line inside a comment, or prose that mentions the name.
      if (/\b(?:function|interface|type|class)\s*$/.test(before)) continue;
      if (/^\s*(?:export\s+)?import\b/.test(line)) continue;
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;
      if (before.includes('//')) continue;
      const openIndex = source.indexOf('(', m.index);
      found.push({ name, index: m.index, lineStart, openIndex, line: lineStartLine(source, m.index) });
      re.lastIndex = openIndex;
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

function lineStartLine(source, index) {
  return source.slice(0, index).split('\n').length;
}

/**
 * Classify one file's send calls.
 * Returns a finding per call whose result is dropped or whose `.catch()` can
 * never fire; `checked` counts the sites that pass, so the OK line says what
 * was actually looked at rather than how many files were opened.
 */
export function classifySource(source, path = '<source>') {
  const findings = [];
  const calls = findCalls(source);
  for (const call of calls) {
    const open = source.indexOf('(', call.index);
    const close = matchParen(source, open);
    if (close === -1) {
      findings.push({ path, line: call.line, name: call.name, kind: 'unparsable',
        why: `${call.name}( … has no matching ) — the screen cannot read this call, so it is not counted as checked` });
      continue;
    }
    // `const r = await sendEmail(` and `return await sendEmail(` are consumed the
    // same way without the await keyword; strip it once so the shape is obvious.
    const head = source.slice(call.lineStart, call.index).trimEnd().replace(/\b(?:await|yield)\s*$/, '').trim();
    const after = source.slice(close + 1, close + 80).trimStart();

    // A `.catch()` on a function that never rejects is a handler for a throw
    // that cannot happen — the exact shape #3045 had to remove three times.
    if (/^\.catch\b/.test(after)) {
      findings.push({ path, line: call.line, name: call.name, kind: 'dead-catch',
        why: `${call.name}() resolves {success:false} rather than rejecting (#3408) — a .catch() here can never fire, so the provider rejection is dropped` });
      continue;
    }

    const bound = /=\s*$/.test(head);
    const returned = /\breturn\b\s*$/.test(head);
    const argument = /[(,[]\s*$/.test(head);
    const arrowBody = /=>\s*$/.test(head);
    const chainedThen = /^\.then\s*\(/.test(after);

    if (bound || returned || argument || arrowBody || chainedThen) continue;
    if (head === '' || /^(?:void|\*|\/\*|})/.test(head)) {
      findings.push({ path, line: call.line, name: call.name, kind: 'unbound',
        why: `the {success:false} from ${call.name}() is discarded — bind it, return it, or read it in a .then((result) => …) (#3408)` });
      continue;
    }
    findings.push({ path, line: call.line, name: call.name, kind: 'unread',
      why: `${call.name}() is called in a shape this screen cannot prove is consumed — bind the result so the check is obvious` });
  }
  return { findings, checked: calls.length };
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
    else if (/\.(?:ts|tsx|mjs)$/.test(e.name) && !/\.test\.[tm]sx?$/.test(e.name)) yield p;
  }
}

export function run(root = process.cwd()) {
  let filesScanned = 0;
  let checked = 0;
  const findings = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(resolve(root, dir))) {
      filesScanned += 1;
      const source = readFileSync(file, 'utf8');
      if (!SEND_FNS.some((n) => source.includes(`${n}(`))) continue;
      const rel = file.slice(resolve(root).length + 1).replace(/\\/g, '/');
      const r = classifySource(source, rel);
      checked += r.checked;
      findings.push(...r.findings);
    }
  }
  return { filesScanned, checked, findings };
}

function main() {
  const { filesScanned, checked, findings } = run();
  if (findings.length > 0) {
    console.error(
      `\n✖ a send result is not consumed (#3408):\n\n` +
        findings.map((f) => `    - ${f.path}:${f.line}  ${f.why}`).join('\n') + '\n',
    );
    console.error(
      '  sendEmail/alertSuperAdmin never reject — they resolve {success:false}. Read\n' +
        '  the value: `const r = await …` then branch on `r.success`, or `.then((r) => …)`.\n'
      + '  A `.catch()` on one of these is a handler for a throw that cannot happen.\n',
    );
    process.exit(1);
  }
  console.log(
    `[check-email-result-consumed] OK — ${checked} send call(s) across ${filesScanned} file(s) `
      + 'under app/, lib/, scripts/ all bind, return or .then() their result; none carries a .catch() '
      + 'that could never fire (#3408).',
  );
}

// Run only when invoked as a CLI, so unit tests can import the pure logic.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
