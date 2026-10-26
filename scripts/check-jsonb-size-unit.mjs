#!/usr/bin/env node
/**
 * #3283 — `jsonb_size_bytes` measured characters for its entire history while 186
 * `chk_*_size` CHECK constraints and a "64KB serialized size" header promised bytes.
 * Nothing in the repository could have caught that, because every existing screen
 * reads the constraint NAME and the migration TEXT: the name said bytes, the file
 * said bytes, and only the body disagreed. This guard reads the body.
 *
 * THREE RULES, ALL STATIC (no database, so it runs on every pull request):
 *
 *   CHAR_COUNT_HELPER  a function whose name claims a byte measure
 *                      (`*_size_bytes`, or anything with `octet` in it) must not
 *                      compute with a bare `length(`. `octet_length(` and
 *                      `char_length(` are byte- and char-true respectively and are
 *                      not matched, which is why the scan is on the character before
 *                      `length`, not on the word.
 *   CEILING_NOT_HELPER a CHECK named `*_size` must call a helper this file can prove
 *                      measures bytes, and must not inline `length(` itself. Scoped to
 *                      the SUFFIX on purpose: `chk_tenants_company_size_length`
 *                      checks a text column called `company_size` with `length()`, and
 *                      is correctly named — a substring rule would call that a finding
 *                      forever. Measured against the live catalog: of 186 `_size`
 *                      CHECKs, 0 do anything but call the helper.
 *   UNIT_UNDOCUMENTED  defining a byte-claiming helper obliges the file to say the
 *                      unit in prose. This is the rule 0051 broke and #3283 exists
 *                      because of.
 *
 * A redefinition wins over the original. `CREATE OR REPLACE FUNCTION` is how a
 * shipped migration is corrected without touching an applied file, so the check is
 * against the LAST journaled definition of a name, not the first — otherwise 0051's
 * historical text would be a permanent finding and the ratchet would be useless.
 *
 * THE RATCHET. `--baseline` names the count this screen tolerates per migration; a
 * run may report fewer (then `--update` to tighten) but never more. `--update`
 * rewrites the baseline and `--print-baseline` shows what it would contain.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MIGRATIONS_DIR = 'drizzle/migrations';
const DEFAULT_BASELINE_PATH = 'scripts/jsonb-size-unit-baseline.json';

/** Repo-relative by default, but a fixture may pass an absolute path. */
const at = (p) => (p === undefined ? undefined : (isAbsolute(p) ? p : join(ROOT, p)));

/** A name that claims a byte measure: `*_size_bytes`, or anything saying `octet`. */
const claimsBytes = (name) => /(_bytes|octet)/i.test(name);

/**
 * `length(` NOT reached through `octet_length(` or `char_length(` — the only form
 * that silently counts characters. Lookbehind on the preceding identifier character
 * is the whole trick: `octet_length(` and `char_length(` both have `_` there.
 */
const bareLength = (text) => /(^|[^0-9a-z_])length\s*\(/i.test(text);

/**
 * Strip SQL comments without stripping the bodies they cannot appear inside.
 * Postgres block comments NEST and dollar quotes are tag-matched, so both are
 * tracked; single-quoted strings honour `''`. Done properly because these headers
 * are written by people describing the very patterns being scanned — prose must not
 * become SQL, and SQL must not become prose.
 */
export function stripSqlComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    if (rest.startsWith('--')) {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;            // keep the newline
      continue;
    }
    if (rest.startsWith('/*')) {
      let depth = 0;
      while (i < text.length) {
        if (text.startsWith('/*', i)) { depth++; i += 2; continue; }
        if (text.startsWith('*/', i)) { depth--; i += 2; if (depth === 0) break; continue; }
        i++;
      }
      out += ' ';
      continue;
    }
    if (text[i] === "'") {                          // string literal: copy verbatim
      let j = i + 1;
      for (;;) {
        if (j >= text.length) break;
        if (text[j] === "'") { if (text[j + 1] === "'") { j += 2; continue; } break; }
        j++;
      }
      out += text.slice(i, Math.min(j + 1, text.length));
      i = j + 1;
      continue;
    }
    const dollar = /^\$[A-Za-z0-9_]*\$/.exec(rest);
    if (dollar) {                                   // dollar-quoted body: copy verbatim
      const tag = dollar[0];
      const end = text.indexOf(tag, i + tag.length);
      const stop = end === -1 ? text.length : end + tag.length;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

/** Every function this file defines, with its declared return type and body. */
export function parseFunctions(sql) {
  const text = stripSqlComments(sql);
  const defs = [];
  const head = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:(?:"?\w+"?)\.)?"?\w+"?)\s*\(([^)]*)\)([\s\S]{0,400}?)?\bAS\b\s*(\$[A-Za-z0-9_]*\$|')/gi;
  let m;
  while ((m = head.exec(text))) {
    const name = m[1].replace(/"/g, '').split('.').pop();
    const tag = m[4];
    const from = m.index + m[0].length;
    const close = tag === "'" ? findStringEnd(text, from) : text.indexOf(tag, from);
    if (close === -1) continue;
    const body = text.slice(from, close);
    const returns = /RETURNS\s+([a-z0-9_ ]+)/i.exec(m[3] ?? '')?.[1]?.trim().toLowerCase();
    defs.push({ name, args: m[2].trim(), returns, body, signature: `${name}(${m[2].trim()})` });
    head.lastIndex = close;
  }
  return defs;
}

function findStringEnd(text, from) {
  let j = from;
  for (;;) {
    if (j >= text.length) return -1;
    if (text[j] === "'") { if (text[j + 1] === "'") { j += 2; continue; } return j; }
    j++;
  }
}

/** Named CHECK constraints, with the balanced expression that follows `CHECK (`. */
export function parseNamedChecks(sql) {
  const text = stripSqlComments(sql);
  const found = [];
  const re = /CONSTRAINT\s+("?\w+"?)\s+CHECK\s*\(/gi;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < text.length && depth > 0) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      i++;
    }
    found.push({
      name: m[1].replace(/"/g, ''),
      expr: text.slice(start, i - 1),
    });
    re.lastIndex = i;
  }
  return found;
}

/** Journal order beats filename order, exactly as the runner applies it. */
export function migrationOrder(dir) {
  const journalPath = join(dir, 'meta', '_journal.json');
  if (!existsSync(journalPath)) return null;
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map((e) => `${e.tag}.sql`)
    .filter((f) => existsSync(join(dir, f)));
}

/**
 * The definition that actually lands for each helper name, in journal order.
 * `[{ file, defs }]` oldest-first; last writer wins.
 */
export function effectiveHelpers(order, dir) {
  const byName = new Map();
  for (const file of order) {
    let sql;
    try { sql = readFileSync(join(dir, file), 'utf8'); } catch { continue; }
    for (const def of parseFunctions(sql)) {
      if (!claimsBytes(def.name)) continue;
      byName.set(def.name, { ...def, file });
    }
  }
  return byName;
}

export function analyse({ dir, baseline = {} }) {
  const order = migrationOrder(dir) ?? [...readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f) && !f.endsWith('.down.sql')).sort()];
  const findings = [];
  const helpers = effectiveHelpers(order, dir);

  for (const [name, def] of helpers) {
    if (bareLength(def.body)) {
      findings.push({
        rule: 'CHAR_COUNT_HELPER',
        file: def.file,
        detail: `${name}(${def.args}) claims a byte measure in its name but its effective body uses a bare length() — a CHARACTER count. `
          + 'Use octet_length(val::text). (A later CREATE OR REPLACE would clear this: '
          + '0051 defines the body, 0139 replaces it, and the replacement is what lands.)',
      });
    }
    const doc = readFileSync(join(dir, def.file), 'utf8');
    const header = doc.slice(0, doc.search(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i) === -1
      ? doc.length : doc.search(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i));
    if (!/\b(bytes?|octet)\b/i.test(header)) {
      findings.push({
        rule: 'UNIT_UNDOCUMENTED',
        file: def.file,
        detail: `${def.file} defines ${name}(), whose name claims bytes, without stating the unit anywhere above the first CREATE FUNCTION. `
          + '#3283: 0051 said "64KB serialized size" over a character-counting body and the mismatch survived 186 constraints.',
      });
    }
  }

  for (const file of order) {
    if (file.endsWith('.down.sql')) continue;
    let sql;
    try { sql = readFileSync(join(dir, file), 'utf8'); } catch { continue; }
    for (const chk of parseNamedChecks(sql)) {
      if (!/_size$/i.test(chk.name)) continue;
      const called = [...chk.expr.matchAll(/(^|[^0-9a-z_])([a-z_][a-z0-9_]*)\s*\(/gi)]
        .map((c) => c[2]).filter((n) => helpers.has(n));
      if (bareLength(chk.expr) || !called.length) {
        const byteTrue = called.filter((n) => !bareLength(helpers.get(n).body));
        findings.push({
          rule: 'CEILING_NOT_HELPER',
          file,
          detail: `${chk.name} is a *_size ceiling that `
            + (bareLength(chk.expr)
              ? 'measures with a bare length() in the expression itself'
              : 'calls no helper this screen can prove measures bytes')
            + (byteTrue.length ? ` (resolved byte-true: ${byteTrue.join(', ')})` : '')
            + `. A ceiling named _size must compare against a byte measure: ${chk.expr.trim().slice(0, 120)}`,
        });
      }
    }
  }

  const perFile = {};
  for (const f of findings) perFile[f.file] = (perFile[f.file] ?? 0) + 1;
  const slackUsed = Object.entries(perFile)
    .filter(([file]) => (baseline[file] ?? 0) < 0 || (perFile[file] ?? 0) > (baseline[file] ?? 0))
    .map(([file]) => `${file}: ${baseline[file] ?? 0} allowed, ${perFile[file]} found`);

  return { findings, perFile, slackUsed, migrations: order.length, helpers: [...helpers.keys()] };
}

export function readBaseline(path) {
  if (!existsSync(path)) return {};
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const { _comment, ...rest } = raw;
  return rest;
}

export async function main(argv = process.argv.slice(2)) {
  const get = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? undefined : argv[i + 1]; };
  const dir = at(get('migrations-dir')) ?? join(ROOT, DEFAULT_MIGRATIONS_DIR);
  const baselinePath = at(get('baseline')) ?? join(ROOT, DEFAULT_BASELINE_PATH);
  const order = migrationOrder(dir);
  if (order === null) {
    process.stderr.write(`[jsonb-size-unit] no meta/_journal.json under ${dir}\n`);
    return 2;
  }
  const result = analyse({ dir, baseline: readBaseline(baselinePath) });

  if (argv.includes('--print-baseline') || argv.includes('--update')) {
    const payload = {
      _comment: '#3283 shrink-only ratchet: findings the jsonb/byte unit screen tolerates per migration file. Lower it as they are fixed; raising it is a regression.',
      ...result.perFile,
    };
    const text = JSON.stringify(payload, null, 2) + '\n';
    if (argv.includes('--update')) writeFileSync(baselinePath, text);
    else process.stdout.write(text);
    if (argv.includes('--update')) {
      process.stdout.write(`[jsonb-size-unit] baseline rewritten: ${Object.keys(result.perFile).length} file(s), `
        + `${Object.values(result.perFile).reduce((a, b) => a + b, 0)} finding(s) tolerated.\n`);
    }
    return 0;
  }

  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    for (const f of result.findings) {
      process.stdout.write(`${f.rule.padEnd(19)} ${f.file}  ${f.detail}\n`);
    }
    process.stdout.write(`\n${result.findings.length} byte-unit defect(s) across ${result.migrations} migrations.`
      + (result.slackUsed.length ? `\nRATCHET EXCEEDED: ${result.slackUsed.join('; ')}` : '') + '\n');
  }
  return result.findings.length || result.slackUsed.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code)).catch((err) => {
    process.stderr.write(`[jsonb-size-unit] ${err?.message ?? err}\n`);
    process.exit(2);
  });
}
