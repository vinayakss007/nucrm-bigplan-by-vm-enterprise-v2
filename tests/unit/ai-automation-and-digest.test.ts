import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { digestFallback } from '@/app/api/cron/ai-weekly-digest/route';

const ROOT = join(import.meta.dirname!, '../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('automation AI draft action (# no migration)', () => {
  const engine = read('lib/automation/engine.ts');

  it('adds an ai_draft action that reuses the allowed draft action string', () => {
    expect(engine).toContain("case 'ai_draft':");
    expect(engine).toContain("action: 'draft'");
    expect(engine).not.toMatch(/action:\s*'ai_draft'/);
  });

  it('routes the result to a human review notification instead of sending it', () => {
    const block = engine.slice(engine.indexOf("case 'ai_draft':"), engine.indexOf("case 'update_field':"));
    expect(block).toContain('createNotification(');
    expect(block).toContain('AI draft ready for review');
    expect(block).not.toContain('sendEmail(');
  });

  it('reports provider outages as action failures without throwing', () => {
    const block = engine.slice(engine.indexOf("case 'ai_draft':"), engine.indexOf("case 'update_field':"));
    expect(block).toContain('instanceof GatewayError');
    expect(block).toContain('actionFailures.push');
  });
});

describe('weekly AI digest cron', () => {
  const route = read('app/api/cron/ai-weekly-digest/route.ts');

  it('uses the cron secret, distributed lock and tenant sweep', () => {
    expect(route).toContain("job: 'ai-weekly-digest'");
    expect(route).toContain("refuseIfCronLockHeld('cron:ai-weekly-digest'");
    expect(route).toContain("sweepTenants('cron/ai-weekly-digest'");
    expect(route).toContain('instrumentCronRun');
  });

  it('reuses an allowed activity action and an in-app notification', () => {
    expect(route).toContain("action: 'summarize'");
    expect(route).toContain('createNotification(');
    expect(route).toContain('if (!(err instanceof GatewayError)) throw err');
  });

  it('is scheduled weekly in vercel.json', () => {
    const config = JSON.parse(read('vercel.json'));
    expect(config.crons).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/api/cron/ai-weekly-digest', schedule: '0 9 * * 1' }),
    ]));
  });

  it('produces a deterministic fallback digest', () => {
    const text = digestFallback({ runs: 5, insights: 2, successes: 4 });
    expect(text).toContain('5 AI action(s)');
    expect(text).toContain('2 saved insight(s)');
    expect(text).toContain('4 completed successfully');
  });
});
