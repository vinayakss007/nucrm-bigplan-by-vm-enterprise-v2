#!/usr/bin/env node
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3412 (slice) — a docs citation that points past the end of its file is rot,
 * and nothing was checking for it.
 *
 * `docs/infra/PREPROD-ISSUE-REGISTER.md` carries ~512 `path:line` citations and
 * the whole `docs/` tree carries ~899. #3412 measured 55 of 216 commits (25%) in
 * six weeks as "pure re-pins" — commits whose only change was moving citation
 * line numbers after code moved. The re-pin machine is visible; the *rot* is
 * not, because growing files hide it and shrinking files produce a citation that
 * points at nothing, with no gate to say so.
 *
 * This screen catches the one unambiguous half of that failure: a citation whose
 * line number is beyond the end of the file it names. It deliberately does NOT
 * try to verify that line N still contains the symbol the prose described —
 * that judgement needs semantics, not arithmetic, and a false-positive machine
 * here would be re-pinned into a baseline within a week, which is the exact
 * behaviour #3412 exists to stop.
 *
 * Division of labour with `guard:coords` (#2416), which is not replaced by this:
 *
 *   - `guard:coords` owns the register's START lines: every `path:N` in
 *     `docs/infra/PREPROD-ISSUE-REGISTER.md` must land on a non-blank line of a
 *     tracked file, plus the keyed `path:"key"` form.
 *   - This screen widens the same arithmetic to every `.md` under `docs/` (196
 *     documents, 912 citations at the time of writing — the register is only
 *     ~520 of them) and adds the check `guard:coords` does not make: the END of a
 *     cited RANGE. `lib/db/ssl-config.ts:33-41` and `next.config.mjs:93-136` are
 *     both real rot found this way that the start-line rule passed, because line
 *     33 and line 93 DO exist; the ranges ran past EOF.
 *   - Overlap is deliberate and harmless: the register's start lines get checked
 *     twice, by a lenient rule here and a stricter one there.
 *
 * What it can and cannot resolve:
 *
 *   - `app/api/x/route.ts:120`      → resolved, checked.
 *   - `drizzle/schema/crm.ts:928`   → resolved, checked.
 *   - `ci.yml:42`, `route.ts:88`    → NOT resolved. Prose uses bare file names
 *                                     as shorthand for "the file named above";
 *                                     guessing which one is a false positive
 *                                     generator. Reported as `unresolvable` and
 *                                     never failed, with the count printed so
 *                                     the shorthand cannot grow silently.
 *   - `../lib/x.ts:40`              → not matched at all. The token rule rejects a
 *                                     path preceded by `/` so that a URL
 *                                     (`https://host/a.ts:12`) never reads as a
 *                                     citation, which also drops a leading `../`.
 *                                     Repo-relative is the house style; the
 *                                     resolver still handles `../` when asked.
 *
 * Known exceptions live in `scripts/citation-bounds-baseline.json`, keyed like
 * `path/to.md::target:line` with a one-line reason. The baseline is a ledger of
 * debt, not a mute button: an entry whose citation is now in range is reported
 * as `stale-baseline` and fails the guard, so the ledger cannot outlive the debt.
 *
 * Usage:
 *   node scripts/check-citation-bounds.mjs            # fail on new rot
 *   node scripts/check-citation-bounds.mjs --verbose  # list every unresolved cite
 *   node scripts/check-citation-bounds.mjs --strict   # also fail on citations
 *                                                     # that drifted onto a blank
 *                                                     # line (off by default: a
 *                                                     # large pre-existing set)
 *   node scripts/check-citation-bounds.mjs --json     # machine-readable report
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');
export const BASELINE_FILE = join(REPO_ROOT, 'scripts', 'citation-bounds-baseline.json');

/** Roots whose markdown is screened. Everything else (agent scratch, node_modules) is out. */
export const DOC_ROOTS = ['docs'];

/**
 * Extensions worth checking. A citation to a binary or an image has no line
 * numbers to drift, and a citation to a directory has no end to run past.
 */
const CHECKABLE = /\.(?:ts|tsx|js|mjs|cjs|jsx|sql|json|yml|yaml|sh|py|md|css|tpl)$/;

/**
 * `path:line` or `path:line-line2`. The leading character class deliberately
 * excludes whitespace and quotes so a fenced code block's `foo.ts:12` is found
 * but an English sentence's `word:12` is not (extensions gate that).
 */
export const CITATION_RE = /(?<![\w./-])([A-Za-z0-9_][A-Za-z0-9_./-]*\.[A-Za-z0-9]+):(\d+)(?:-(\d+))?/g;

/** Markdown that is one long line must not produce one 10 MB "citation". */
const MAX_TARGET_LENGTH = 200;

export function readBaseline(path = BASELINE_FILE) {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    throw new Error(`citation-bounds-baseline.json is not valid JSON: ${err.message}`);
  }
}

function lineCount(file) {
  const text = readFileSync(file, 'utf8');
  // A trailing newline does not start a new line: `a\n` is one line, not two.
  const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text;
  return trimmed.split('\n').length;
}

function lineAt(file, line) {
  const lines = readFileSync(file, 'utf8').split('\n');
  return lines[line - 1] ?? '';
}

function listMarkdown(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        out.push(full);
      }
    }
  };
  if (existsSync(root) && statSync(root).isDirectory()) walk(root);
  return out;
}

/**
 * Resolve a cited path the only way that cannot produce a false positive:
 * as written, from the repo root, then relative to the citing document.
 * Anything else is `unresolvable` — see the header for why guessing is worse.
 */
export function resolveCitation(target, docPath, root = REPO_ROOT) {
  if (target.length > MAX_TARGET_LENGTH) return null;
  if (!CHECKABLE.test(target)) return null;
  const candidates = [resolve(root, target), resolve(dirname(docPath), target)];
  for (const candidate of candidates) {
    if (!candidate.startsWith(root)) continue;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Scan one document. Pure: returns a report, never exits, never writes.
 *
 * `citations` is every `path:line` found (so the caller can report coverage),
 * while `findings` holds only the ones worth a verdict:
 *   `out-of-range` — the cited line (or a cited range's end) is past the end of
 *                    the file: the rot this screen exists for.
 *   `blank-line`   — only with `flagBlank`; often a citation that drifted onto
 *                    an empty line after the code below it moved.
 *   `unresolvable` — the target could not be resolved as written. Reported,
 *                    never failed: bare `ci.yml:42` shorthand is prose, not rot.
 */
export function scanDocument(docPath, options = {}) {
  const flagBlank = options.flagBlank ?? false;
  // `root` is injectable so the guard's own tests can run against fixtures in a
  // temp directory instead of mutating this repo's docs.
  const root = options.root ?? REPO_ROOT;
  const text = readFileSync(docPath, 'utf8');
  const findings = [];
  let citations = 0;
  const re = new RegExp(CITATION_RE.source, 'g');
  let match;
  while ((match = re.exec(text)) !== null) {
    const [, target, rawLine, rawEnd] = match;
    const line = Number(rawLine);
    const end = rawEnd ? Number(rawEnd) : line;
    if (!Number.isFinite(line) || line < 1) continue;
    citations += 1;

    const resolved = resolveCitation(target, docPath, root);
    if (!resolved) {
      findings.push({
        kind: 'unresolvable',
        doc: relative(root, docPath),
        target,
        line,
      });
      continue;
    }

    const total = lineCount(resolved);
    if (line > total || end > total) {
      findings.push({
        kind: 'out-of-range',
        doc: relative(root, docPath),
        target: relative(root, resolved),
        line,
        end,
        fileLines: total,
      });
      continue;
    }

    if (flagBlank && lineAt(resolved, line).trim() === '') {
      findings.push({
        kind: 'blank-line',
        doc: relative(root, docPath),
        target: relative(root, resolved),
        line,
      });
    }
  }
  return { doc: relative(root, docPath), citations, findings };
}

/** `doc::target:line` — the baseline key. Line-only, so a range re-pin is one entry. */
export function baselineKey(finding) {
  return `${finding.doc}::${finding.target}:${finding.line}`;
}

export function check(options = {}) {
  const root = options.root ?? REPO_ROOT;
  const roots = options.roots ?? DOC_ROOTS.map((entry) => join(root, entry));
  const baseline = options.baseline ?? readBaseline(options.baselineFile);
  const docs = roots.flatMap(listMarkdown);

  const scans = docs.map((doc) =>
    scanDocument(doc, { flagBlank: options.flagBlank ?? false, root }),
  );
  const findings = scans.flatMap((scan) => scan.findings);
  const citations = scans.reduce((total, scan) => total + scan.citations, 0);

  const rot = findings.filter((f) => f.kind === 'out-of-range' || f.kind === 'blank-line');
  const unresolvable = findings.filter((f) => f.kind === 'unresolvable');

  const failures = [];
  const baselined = [];
  for (const finding of rot) {
    const key = baselineKey(finding);
    if (Object.prototype.hasOwnProperty.call(baseline, key)) {
      baselined.push({ ...finding, reason: baseline[key] });
    } else {
      failures.push(finding);
    }
  }

  // A ledger entry that no longer describes rot is itself debt: drop it or the
  // baseline becomes a place where citations go to be forgotten.
  const rotKeys = new Set(rot.map(baselineKey));
  const staleBaseline = Object.keys(baseline).filter((key) => !rotKeys.has(key));

  return {
    documentsScanned: docs.length,
    citations,
    citationsResolved: citations - unresolvable.length,
    citationsUnresolvable: unresolvable.length,
    outOfRange: rot.filter((f) => f.kind === 'out-of-range').length,
    blankLines: rot.filter((f) => f.kind === 'blank-line').length,
    baselined: baselined.length,
    failures,
    staleBaseline,
    unresolvable,
  };
}

function main(argv) {
  const verbose = argv.includes('--verbose');
  const asJson = argv.includes('--json');
  const flagBlank = argv.includes('--strict');

  let report;
  try {
    report = check({ verbose, flagBlank });
  } catch (err) {
    console.error(`citation-bounds: ${err.message}`);
    process.exit(2);
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `citation-bounds: ${report.documentsScanned} docs, ${report.citations} citations, ` +
        `${report.citationsResolved} resolved and checked, ` +
        `${report.citationsUnresolvable} unresolvable (bare-name shorthand — not failed)`,
    );
    if (report.baselined > 0) {
      console.log(`  ${report.baselined} citation(s) tolerated by the baseline ledger`);
    }
  }

  if (report.failures.length > 0) {
    console.error('');
    console.error(`✖ ${report.failures.length} citation(s) point past the end of their file:`);
    for (const failure of report.failures) {
      const range = failure.end && failure.end !== failure.line ? `${failure.line}-${failure.end}` : `${failure.line}`;
      console.error(
        `    ${failure.doc}: ${failure.target}:${range}` +
          (failure.fileLines ? `  (file has ${failure.fileLines} lines)` : '  (blank line)'),
      );
    }
    console.error('');
    console.error('  Fix the citation, or — if it is knowingly stale — add a keyed entry with a');
    console.error('  reason to scripts/citation-bounds-baseline.json.');
    process.exit(1);
  }

  if (report.staleBaseline.length > 0) {
    console.error('');
    console.error(`✖ ${report.staleBaseline.length} baseline entr(y/ies) no longer describe rot:`);
    for (const key of report.staleBaseline) console.error(`    ${key}`);
    console.error('  Remove them: a ledger that outlives its debt hides the next one.');
    process.exit(1);
  }

  if (verbose && report.unresolvable.length > 0) {
    console.log('');
    console.log('Unresolvable citations (reported, never failed):');
    for (const entry of report.unresolvable) {
      console.log(`    ${entry.doc}: ${entry.target}:${entry.line}`);
    }
  }

  console.log('✔ Every resolvable citation points at a line that exists.');
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main(process.argv.slice(2));
