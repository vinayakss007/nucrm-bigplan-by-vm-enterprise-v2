/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3275 — the restart knobs and the runbook have to agree.
 *
 * `GET / 502 rt=0.000` in the access log was read as a bug that `wait_ready: true`
 * would fix. It would not: pm2 waits for the supervised child to *signal*
 * readiness (`process.send('process_ready')`), `next start` never does, and in
 * `exec_mode: 'cluster'` a worker's `listening` event is the fd handover rather
 * than a warm app — so flipping that key turns a short outage into a reload that
 * times out and kills the process it was meant to protect.
 *
 * The issue's accepted alternative is to document the outage. A documented
 * workaround rots the moment someone "fixes" the config, so this pins the pair:
 * no readiness claim without a readiness signal in the process it supervises, and
 * the runbook section that tells an operator to expect the 502s stays in the tree.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const CONFIG = read('ecosystem.config.cjs');
const RUNBOOK = read('deploy/LAUNCH_RUNBOOK.md');

/**
 * The app object for one pm2 process, found by brace matching from the `{` that
 * opens it. A regex over `[^}]*` would stop at the first nested object (`env: {`)
 * and report the keys after it as absent — which is exactly the false pass this
 * screen must not produce.
 */
function appBlock(text: string, appName: string): string {
  const at = text.search(new RegExp(`name:\\s*'${appName}'`));
  if (at < 0) throw new Error(`no '${appName}' app in ecosystem.config.cjs`);
  const open = text.lastIndexOf('{', at);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces after the '${appName}' app`);
}

const web = appBlock(CONFIG, 'web');
const runbookSection = /## §9\.[\s\S]*?(?=\n## )/.exec(RUNBOOK)?.[0] ?? '';

describe('#3275 the web app restart is documented as an outage, not as zero-downtime', () => {
  it('reads the real web app block, not an empty match', () => {
    // Control: without this, every assertion below could pass on a slice of ''.
    expect(web).toMatch(/exec_mode:\s*'cluster'/);
    expect(web).toMatch(/script:\s*'node_modules\/\.bin\/next'/);
    expect(web).toMatch(/max_memory_restart/);
    expect(runbookSection.length).toBeGreaterThan(200);
  });

  it('does not claim a readiness signal the supervised process cannot send', () => {
    expect(web, 'wait_ready needs process.send("process_ready") in what pm2 supervises; `next start` has none').not.toMatch(/wait_ready\s*:/);
  });

  it('keeps the two knobs that bound the shutdown, and points at the runbook', () => {
    expect(web).toMatch(/kill_timeout:\s*10000/);
    expect(web).toMatch(/listen_timeout:\s*5000/);
    expect(web).toMatch(/shutdown_with_message:\s*true/);
    expect(web).toMatch(/LAUNCH_RUNBOOK\.md §9/);
  });

  it('documents what an operator is supposed to do about it', () => {
    expect(runbookSection).toMatch(/#3275/);
    expect(runbookSection).toMatch(/wait_ready/);
    expect(runbookSection).toMatch(/502/);
    expect(runbookSection).toMatch(/cluster/);
    expect(runbookSection).toMatch(/pm2-restart-outage-3275\.test\.ts/);
  });

  it('says the thing the deploy workflow actually runs', () => {
    // §9 tells the operator the rollout is a restart, not a reload. If the
    // workflow changes, the section that sets expectations has to change with it.
    const workflow = read('.github/workflows/deploy.yml');
    if (/pm2\s+reload/.test(workflow)) {
      throw new Error('.github/workflows/deploy.yml reloads pm2; update deploy/LAUNCH_RUNBOOK.md §9 to describe the overlap it now attempts');
    }
    expect(workflow).toMatch(/pm2 restart/);
  });
});
