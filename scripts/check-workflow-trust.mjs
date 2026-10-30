/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Workflow trust-boundary guard (#3267).
 *
 * The standing constraint on the deploy host is "do not register the
 * self-hosted runner before the guard lands": the deploy job SSHes to a VM that
 * holds the app role's DSN, so a workflow that can reach the runner can reach
 * the secret. Nothing asserted any of it — actionlint reports parse errors and
 * `check-deploy-trigger.mjs` reports name/branch wiring, and both stay green
 * for a PR that puts `runs-on: self-hosted` on a `pull_request` job, drops the
 * `branches: [main]` filter a `workflow_run` trigger depends on, or deletes a
 * `permissions:` block. Six rules, none of which those two can see:
 *   1. every workflow declares a top-level `permissions:` block, so a job token
 *      never inherits the repository default;
 *   2. no `pull_request_target` — fork code running with base-context secrets;
 *   3. no `self-hosted` runner on a job of a fork-reachable workflow;
 *   4. no fork-reachable job reads a real secret without either an `||` fallback
 *      (a fork run cannot resolve the left side, so that is the accepted
 *      fork-safe form) or an `if:` that excludes fork code;
 *   5. a `workflow_run` trigger keeps its `branches:` filter and some job keeps
 *      a `conclusion` gate — what makes "deploy what CI verified on main" true
 *      rather than aspirational;
 *   6. a job that reads a `DEPLOY_*` secret names an `environment:`, so the
 *      owner has somewhere to scope the VM credentials that a fork cannot reach.
 *
 * Reads YAML text only — expressions are never resolved, so no secret value can
 * reach the output; names are all it prints.
 *
 * Usage: node scripts/check-workflow-trust.mjs [workflows-dir]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOWS_DIR = process.argv[2] ?? '.github/workflows';
const FORK_EVENTS = new Set(['pull_request', 'pull_request_target']);
const DEPLOY_SECRET = /^DEPLOY_/;

const stripComment = (line) => {
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
};

const indentOf = (line) => line.match(/^ */)[0].length;
const unquote = (s) => s.trim().replace(/^["']|["']$/g, '');

/** A `key:` line at indent 0, as {index, inline} — inline is '' for a block value. */
function topLevel(lines, key) {
  const re = new RegExp(`^"?${key}"?:`);
  const index = lines.findIndex((l) => re.test(l));
  if (index < 0) return null;
  const line = stripComment(lines[index]);
  return { index, inline: line.slice(line.indexOf(':') + 1).trim() };
}

/** The indented body under a top-level key: comment-stripped, blank lines dropped. */
function topBody(lines, found) {
  if (!found) return [];
  const body = [];
  for (let i = found.index + 1; i < lines.length; i++) {
    const raw = stripComment(lines[i]);
    if (raw.trim() === '') continue;
    if (indentOf(raw) === 0) break;
    body.push(raw);
  }
  return body;
}

/** Split an indented block into sibling sections at its shallowest indent. */
function sections(body) {
  if (body.length === 0) return [];
  const indent = Math.min(...body.map(indentOf));
  const out = [];
  let current = null;
  for (const line of body) {
    if (indentOf(line) === indent) {
      const colon = line.indexOf(':');
      current = { key: unquote(line.slice(0, colon)), inline: line.slice(colon + 1).trim(), lines: [] };
      out.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return out;
}

/** A job's `if:` / `runs-on:` / `environment:`, folding a block scalar into one string. */
function jobField(job, key) {
  if (!job) return '';
  const jobIndent = Math.min(...job.lines.map(indentOf));
  const re = new RegExp(`^${key}:`);
  const i = job.lines.findIndex((l) => indentOf(l) === jobIndent && re.test(l.trimStart()));
  if (i < 0) return '';
  const line = job.lines[i];
  const value = line.slice(line.indexOf(':') + 1).trim();
  if (!/^[|>][-+]?\d*$/.test(value)) return value;
  const deeper = [];
  for (let n = i + 1; n < job.lines.length; n++) {
    if (indentOf(job.lines[n]) <= jobIndent) break;
    deeper.push(job.lines[n].trim());
  }
  return deeper.join(' ');
}

/** Every `secrets.NAME` a job body mentions, and whether its expression has a `||` fallback. */
function secretsIn(text) {
  const found = [];
  for (const expr of text.match(/\$\{\{[^}]*\}\}/g) ?? []) {
    for (const mention of expr.match(/secrets\.[A-Za-z_]\w*/g) ?? []) {
      found.push({ name: mention.slice('secrets.'.length), fallback: expr.includes('||') });
    }
  }
  return found;
}

/** An `if:` a fork pull request cannot satisfy. GitHub always fills the head-repo
 *  fields on a fork PR, so equality with `github.repository` is the exclusion that holds. */
function excludesForkCode(ifText) {
  return [
    /head\.repo\.full_name\s*==\s*github\.repository/,
    /github\.repository\s*==/,
    /event_name\s*!=\s*['"]pull_request/,
    /event_name\s*==\s*['"]push['"]/,
    /event_name\s*==\s*['"]workflow_(dispatch|run)['"]/,
  ].some((re) => re.test(ifText));
}

function screenWorkflow(file, text) {
  const problems = [];
  const lines = text.split(/\r?\n/);
  const onFound = topLevel(lines, 'on');
  const triggers = [];
  if (onFound) {
    if (onFound.inline.startsWith('[')) {
      for (const item of onFound.inline.slice(1, -1).split(',')) {
        if (item.trim()) triggers.push({ name: unquote(item), body: [] });
      }
    } else if (onFound.inline) {
      triggers.push({ name: unquote(onFound.inline), body: [] });
    } else {
      for (const section of sections(topBody(lines, onFound))) {
        triggers.push({ name: section.key, body: section.lines });
      }
    }
  }
  const names = new Set(triggers.map((t) => t.name));
  const forkEvents = [...names].filter((n) => FORK_EVENTS.has(n));
  const forkReachable = forkEvents.length > 0;
  const jobs = sections(topBody(lines, topLevel(lines, 'jobs')));

  if (!onFound) problems.push(`${file}: no on: trigger to screen`);
  if (!topLevel(lines, 'permissions')) {
    problems.push(`${file}: no top-level permissions: block — every job inherits the repository default token instead`);
  }
  if (names.has('pull_request_target')) {
    problems.push(`${file}: on: pull_request_target — fork code runs with base-context secrets, which #3267 rules out outright`);
  }

  const workflowRun = triggers.find((t) => t.name === 'workflow_run');
  if (workflowRun) {
    const branches = sections(workflowRun.body).find((c) => c.key === 'branches');
    if (!branches || (branches.inline === '' && branches.lines.length === 0)) {
      problems.push(`${file}: on.workflow_run has no branches: filter, so a green CI run on any branch would deploy that branch`);
    }
    if (!jobs.some((job) => /conclusion/.test(jobField(job, 'if')))) {
      problems.push(`${file}: on.workflow_run fires on failure too, and no job gates on github.event.workflow_run.conclusion`);
    }
  }

  for (const job of jobs) {
    const at = `${file}: job ${job.key}`;
    const ifText = jobField(job, 'if');
    const runsOn = jobField(job, 'runs-on');
    const environment = jobField(job, 'environment');
    const secrets = secretsIn(job.lines.join('\n'));

    if (forkReachable && /self-hosted/.test(runsOn)) {
      problems.push(
        `${at}: runs-on: ${runsOn} in a workflow reachable from ${forkEvents.join('/')}` +
          `${excludesForkCode(ifText) ? '' : ' with no fork-excluding if:'} — a job that can land on the` +
          ` runner can reach whatever the runner's host can read`,
      );
    }

    if (forkReachable && !excludesForkCode(ifText)) {
      for (const secret of secrets) {
        if (secret.name === 'GITHUB_TOKEN' || secret.fallback) continue;
        problems.push(
          `${at}: reads secrets.${secret.name} on a fork-reachable path with no || fallback and no fork-excluding if:`,
        );
      }
    }

    for (const secret of [...new Map(secrets.map((s) => [s.name, s])).values()]) {
      if (!DEPLOY_SECRET.test(secret.name) || environment) continue;
      problems.push(
        `${at}: reads secrets.${secret.name} but names no environment: — the VM credentials stay repository-scoped, ` +
          `so only this job's own if: keeps a workflow-edit run from aiming them somewhere else`,
      );
    }
  }

  return { problems, jobs: jobs.length };
}

const files = readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
const problems = [];
let jobCount = 0;

for (const name of files) {
  const scanned = screenWorkflow(name, readFileSync(join(WORKFLOWS_DIR, name), 'utf8'));
  jobCount += scanned.jobs;
  problems.push(...scanned.problems);
}

if (problems.length > 0) {
  console.error(`\n✖ workflow trust boundary is not held (#3267):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    `\n  The rule: a fork pull request cannot reach a real secret, a self-hosted runner, or the ` +
      `VM. Fix the workflow, or gate the job with an if: that a fork cannot satisfy.\n`,
  );
  process.exit(1);
}

console.log(
  `[check-workflow-trust] OK — ${files.length} workflow(s), ${jobCount} job(s): no fork-reachable secret, ` +
    `no fork-reachable self-hosted runner, no pull_request_target, every workflow declares permissions, ` +
    `and every DEPLOY_* job names an environment.`,
);
