/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Deploy-trigger wiring guard.
 *
 * Real incident this stops (2026-09-05 → 2026-09-13, 8 days of silent muting):
 *  - commit 48efd68c landed a duplicate YAML key in .github/workflows/ci.yml,
 *    so the file no longer parsed. GitHub quietly registered that workflow
 *    under its FILE PATH (".github/workflows/ci.yml") instead of the declared
 *    `name: CI`, and every run of it produced 0 jobs.
 *  - deploy.yml starts auto-deploys on `on.workflow_run.workflows: ["CI"]`, and
 *    GitHub matches that filter against the workflow NAME only. Once the name
 *    was gone the filter could not match, so NO Deploy run was even created —
 *    not even a skipped one — and the deploy pipeline went mute without a
 *    single red X pointing at it. Last Deploy run that exists: 2026-09-05T08:40Z.
 *
 * YAML *validity* is actionlint's job (it reports the duplicate keys). This
 * guard covers what actionlint cannot see, because actionlint never compares a
 * trigger filter against the workflows that actually exist:
 *   1. deploy.yml still has an `on.workflow_run` trigger at all;
 *   2. the name in its `workflows:` filter is the name ci.yml declares;
 *   3. that trigger is still scoped to `branches: [main]` (without it, a green
 *      CI run on any branch would deploy that branch's commit to the VM);
 *   4. no two workflow files declare the same `name:` (a name filter would
 *      then fire twice).
 *
 * Usage (from the repo root): node scripts/check-deploy-trigger.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOWS_DIR = '.github/workflows';
const CI_FILE = join(WORKFLOWS_DIR, 'ci.yml');
const DEPLOY_FILE = join(WORKFLOWS_DIR, 'deploy.yml');

const RED = '\u001b[31m';
const YELLOW = '\u001b[33m';
const RESET = '\u001b[0m';

/** @type {string[]} */
const problems = [];
/** @type {string[]} */
const warnings = [];

const fail = (message) => problems.push(message);
const warn = (message) => warnings.push(message);

const readLines = (file) => readFileSync(file, 'utf8').split(/\r?\n/);
const indentOf = (line) => line.match(/^ */)[0].length;
const unquote = (s) => s.trim().replace(/^["']|["']$/g, '');
const isBlank = (line) =>
  line.trim() === '' || line.trim().startsWith('#') || line.trim() === '---';

/** Drop a trailing `# comment` that sits outside of quotes. */
function stripComment(line) {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).replace(/\s+$/, '');
    }
  }
  return line.replace(/\s+$/, '');
}

/**
 * Find a `key:` mapping line within indent bounds.
 * @returns {{index: number, indent: number, value: string} | null}
 */
function findKey(lines, key, { minIndent = 0, maxIndent = 99, from = 0, to = lines.length } = {}) {
  for (let i = from; i < to; i++) {
    const line = stripComment(lines[i]);
    if (isBlank(line)) continue;
    const indent = indentOf(line);
    if (indent < minIndent || indent > maxIndent) continue;
    if (line.trim().startsWith(`${key}:`)) {
      return { index: i, indent, value: line.trim().slice(key.length + 1).trim() };
    }
  }
  return null;
}

/** Index of the first line after `keyLine` that dedents out of its block. */
function blockEnd(lines, keyLine) {
  for (let i = keyLine.index + 1; i < lines.length; i++) {
    const line = stripComment(lines[i]);
    if (isBlank(line)) continue;
    if (indentOf(line) <= keyLine.indent) return i;
  }
  return lines.length;
}

/** Read an inline `[a, b]` list or a block `- a` list belonging to `keyLine`. */
function parseList(lines, keyLine, endIndex) {
  if (keyLine.value) {
    const inner = keyLine.value.replace(/^\[/, '').replace(/\]$/, '');
    return inner
      .split(',')
      .map(unquote)
      .filter(Boolean);
  }
  const out = [];
  for (let i = keyLine.index + 1; i < endIndex; i++) {
    const line = stripComment(lines[i]);
    if (isBlank(line)) continue;
    if (indentOf(line) <= keyLine.indent) break;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item) out.push(unquote(item[1]));
  }
  return out;
}

const ciLines = readLines(CI_FILE);
const deployLines = readLines(DEPLOY_FILE);

// ── 1. The name the CI workflow declares (top-level `name:`) ──────────────────
const ciNameLine = findKey(ciLines, 'name', { minIndent: 0, maxIndent: 0 });
const ciName = ciNameLine ? unquote(ciNameLine.value) : null;
if (!ciName) {
  fail(
    `${CI_FILE} declares no top-level \`name:\`. A workflow_run filter can only match a ` +
      `declared name — without one GitHub falls back to the file path and Deploy stops firing.`,
  );
}

// ── 2. deploy.yml's workflow_run trigger ─────────────────────────────────────
const onLine = findKey(deployLines, 'on', { minIndent: 0, maxIndent: 0 });
let workflowRunNames = [];
let workflowRunBranches = [];
if (!onLine) {
  fail(`${DEPLOY_FILE} has no top-level \`on:\` block — no trigger at all.`);
} else {
  const onEnd = blockEnd(deployLines, onLine);
  const wrLine = findKey(deployLines, 'workflow_run', {
    minIndent: onLine.indent + 1,
    from: onLine.index + 1,
    to: onEnd,
  });
  if (!wrLine) {
    fail(
      `${DEPLOY_FILE} no longer triggers on \`workflow_run\` inside \`on:\`. Auto-deploy is ` +
        `muted — only an explicit workflow_dispatch would ever deploy main.`,
    );
  } else {
    const wrEnd = blockEnd(deployLines, wrLine);
    const start = wrLine.index + 1;
    const namesLine = findKey(deployLines, 'workflows', {
      minIndent: wrLine.indent + 1,
      from: start,
      to: wrEnd,
    });
    if (!namesLine) {
      fail(
        `${DEPLOY_FILE}'s on.workflow_run has no \`workflows:\` filter, so it would fire for ` +
          `EVERY workflow that completes on main (lint, dependabot, …), not just CI.`,
      );
    } else {
      workflowRunNames = parseList(deployLines, namesLine, wrEnd);
      if (workflowRunNames.length === 0) {
        fail(`${DEPLOY_FILE}'s on.workflow_run.workflows is empty — nothing can trigger a deploy.`);
      }
    }
    const branchesLine = findKey(deployLines, 'branches', {
      minIndent: wrLine.indent + 1,
      from: start,
      to: wrEnd,
    });
    workflowRunBranches = branchesLine ? parseList(deployLines, branchesLine, wrEnd) : [];
    if (!workflowRunBranches.includes('main')) {
      fail(
        `${DEPLOY_FILE}'s on.workflow_run is not scoped to \`branches: [main]\`${
          workflowRunBranches.length ? ` (found ${JSON.stringify(workflowRunBranches)})` : ''
        }. Without it, a green CI run on ANY branch would deploy that branch's commit to the VM.`,
      );
    }
  }
}

// ── 3. The filter must still match the CI workflow's declared name ───────────
if (ciName && workflowRunNames.length > 0 && !workflowRunNames.includes(ciName)) {
  fail(
    `${DEPLOY_FILE} waits for ${JSON.stringify(workflowRunNames)} but ${CI_FILE} declares ` +
      `\`name: ${ciName}\`.\n` +
      `      GitHub matches workflow_run.workflows against the workflow NAME (or, once the file\n` +
      `      fails to parse, its file path). No match means no Deploy run is created at all —\n` +
      `      silently, exactly like 2026-09-05 → 2026-09-13.\n` +
      `      Fix: in ${DEPLOY_FILE} use  on.workflow_run.workflows: [${JSON.stringify(ciName)}]  ` +
      `(or revert the rename in ${CI_FILE}).`,
  );
}

// ── 4. Duplicate workflow names make a name filter ambiguous ─────────────────
const byName = new Map();
for (const file of readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f))) {
  const path = join(WORKFLOWS_DIR, file);
  const nameLine = findKey(readLines(path), 'name', { minIndent: 0, maxIndent: 0 });
  const name = nameLine ? unquote(nameLine.value) : null;
  if (!name) {
    warn(`${path} declares no top-level \`name:\` (GitHub will fall back to the file path).`);
    continue;
  }
  if (byName.has(name)) {
    fail(
      `${path} and ${byName.get(name)} both declare \`name: ${name}\` — a workflow_run.workflows ` +
        `filter on that name would fire for both.`,
    );
  } else {
    byName.set(name, path);
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
for (const w of warnings) console.error(`${YELLOW}⚠ ${w}${RESET}`);
if (problems.length > 0) {
  console.error(
    `\n${RED}✖ Deploy trigger wiring is broken (${problems.length} problem${
      problems.length === 1 ? '' : 's'
    }):${RESET}\n\n` +
      problems.map((p) => `    - ${p}`).join('\n\n') +
      `\n\n  This guard exists because the 2026-09-05 duplicate-key incident muted auto-deploy\n` +
      `  for 8 days without a single Deploy run being created. Keep the CI workflow name and\n` +
      `  ${DEPLOY_FILE}'s workflow_run filter in sync.\n`,
  );
  process.exit(1);
}

console.log(
  `[check-deploy-trigger] OK — ${CI_FILE} declares "name: ${ciName}"; ${DEPLOY_FILE} waits on ` +
    `${JSON.stringify(workflowRunNames)} scoped to ${JSON.stringify(workflowRunBranches)}; ` +
    `${byName.size} uniquely-named workflow file${byName.size === 1 ? '' : 's'}.`,
);

