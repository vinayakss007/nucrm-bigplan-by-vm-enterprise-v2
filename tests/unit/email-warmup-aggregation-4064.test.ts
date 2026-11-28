import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'lib/email/warmup.ts'), 'utf8');

describe('email warmup config aggregation (#4064)', () => {
  it('uses one grouped aggregate instead of three correlated count subqueries', () => {
    expect(src).toContain('.leftJoin(emailWarmupLogs');
    expect(src).toContain('.groupBy(emailWarmupConfigs.id)');
    expect(src.match(/COALESCE\(SUM\(CASE WHEN/g)).toHaveLength(3);
    expect(src).not.toContain('(SELECT count(*)::int FROM ${emailWarmupLogs}');
  });

  it('preserves the sent/failed status semantics the bounce gate relies on', () => {
    expect(src).toContain("status} = 'sent'");
    expect(src).toContain("status} = 'failed'");
    expect(src).toContain("CURRENT_DATE - INTERVAL '7 days'");
    expect(src).toContain('WARMUP_BOUNCE_RATE_THRESHOLD');
  });
});
