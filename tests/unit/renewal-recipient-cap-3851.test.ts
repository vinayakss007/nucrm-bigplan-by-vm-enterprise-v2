import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'app/api/cron');
const contract = readFileSync(join(ROOT, 'contract-renewal-check/route.ts'), 'utf8');
const subscription = readFileSync(join(ROOT, 'subscription-renewal-check/route.ts'), 'utf8');

describe('renewal reminders notify every active member (#3851)', () => {
  for (const [name, src] of [['contract', contract], ['subscription', subscription]] as const) {
    it(`${name} cron has no recipient cap`, () => {
      expect(src).not.toMatch(/\.limit\(5\)/);
      expect(name === 'contract' ? contract : subscription).toContain("status = 'active'");
    });
  }

  it('contract cron still reports missing recipients', () => {
    expect(contract).toContain('remindersWithoutRecipient');
    expect(contract).toContain('membersByTenant.set(tid, members)');
  });

  it('subscription cron still skips and reports tenants with no members', () => {
    expect(subscription).toContain('if (members.length === 0)');
    expect(subscription).toContain('remindersWithoutRecipient++');
  });
});
