import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #2300 — the Deploy workflow restarted only the web process, so worker
 * (BullMQ consumers) and cron (scheduler) kept running pre-deploy code while
 * web shipped new queue payload formats — invisible mixed-version processing.
 *
 * This workflow can only be observed on the deploy host (SSH), so these are
 * static assertions on the workflow script itself: they pin the structure
 * that makes the bug impossible to reintroduce (all three apps restarted on
 * both the forward and the rollback path, gated on pm2 status, web health
 * first).
 */

const ROOT = join(import.meta.dirname!, '..', '..');
const WF = readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8');

describe('deploy workflow restarts every pm2 app (#2300)', () => {
  it('names worker and cron as background apps', () => {
    expect(WF).toMatch(/BG_APPS="worker cron"/);
    // ecosystem.config.cjs really declares exactly these two beside web
    const eco = readFileSync(join(ROOT, 'ecosystem.config.cjs'), 'utf8');
    for (const app of ['worker', 'cron', 'web']) {
      expect(eco, `ecosystem declares ${app}`).toContain(`name: '${app}'`);
    }
  });

  it('restarts an existing background app, starts a missing one from the ecosystem file', () => {
    expect(WF).toContain('pm2 restart "$APP" --update-env');
    expect(WF).toContain('pm2 start ecosystem.config.cjs --only "$APP"');
    expect(WF).toMatch(/pm2 describe "\$APP" >\/dev\/null/);
  });

  it('gates background apps on pm2 status, failing fast on errored', () => {
    expect(WF).toMatch(/bg_gate\(\)/);
    expect(WF).toContain('pm2 jlist');
    expect(WF).toMatch(/= "online"/);
    expect(WF).toMatch(/= "errored"/);
    // the errored branch must not sleep-retry the whole budget: it breaks,
    // then the outer check reports FAIL — assert both halves exist
    expect(WF).toMatch(/ERRORED[\s\S]{0,120}break\n/);
    expect(WF).toMatch(/FAIL: background consumer/);
  });

  it('web health gates BEFORE background apps are churned', () => {
    const body = WF.match(/deploy_all_and_wait\(\) \{[\s\S]*?\n            \}/);
    expect(body, 'deploy_all_and_wait definition missing').toBeTruthy();
    const restartIdx = body![0].indexOf('restart_and_wait');
    const bgRestartIdx = body![0].indexOf('restart_background_apps');
    const gateIdx = body![0].indexOf('bg_gate');
    expect(restartIdx).toBeGreaterThanOrEqual(0);
    expect(restartIdx).toBeLessThan(bgRestartIdx);
    expect(bgRestartIdx).toBeLessThan(gateIdx);
  });

  it('BOTH the forward deploy and the rollback run the all-apps unit — no bare restart_and_wait call sites', () => {
    const calls = [...WF.matchAll(/^\s+if deploy_all_and_wait; then$/gm)];
    expect(calls.length).toBe(2);
    const bare = [...WF.matchAll(/^\s+if restart_and_wait; then$/gm)];
    expect(bare.length).toBe(0);
  });

  it('the deploy log names each app restarted (acceptance: observable per-app)', () => {
    expect(WF).toMatch(/Restarting pm2 app \$APP onto \$SHA|pm2 app \$APP missing/);
    expect(WF).toMatch(/Deploy complete.*pm2 apps restarted: \$PM2_APP, worker, cron/);
  });

  it('background state is persisted so a host reboot restores all three apps', () => {
    // pm2 save appears in the background restart path (dump list includes new apps)
    expect(WF).toMatch(/restart_background_apps\(\) \{[\s\S]*?pm2 save/);
  });
});
