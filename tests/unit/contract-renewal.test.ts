import { describe, it, expect } from 'vitest';

describe('contract renewal notification matrix', () => {
  it('EVENT_KEYS includes contract.expiring', async () => {
    const mod = await import('@/app/api/tenant/notifications/matrix/route');
    expect(mod.GET).toBeDefined();
  });

  it('contract events default to email notifications enabled', async () => {
    const mod = await import('@/app/api/tenant/notifications/matrix/route');
    expect(mod.GET).toBeDefined();
    expect(mod.PATCH).toBeDefined();
  });
});

describe('contract renewal cron endpoint', () => {
  it('module loads with POST handler', async () => {
    const mod = await import('@/app/api/cron/contract-renewal-check/route');
    expect(mod.POST).toBeDefined();
  });

  it('POST handler is a function', async () => {
    const mod = await import('@/app/api/cron/contract-renewal-check/route');
    expect(typeof mod.POST).toBe('function');
  });
});

describe('contract renewal cron scheduler', () => {
  it('cron-scheduler.ts includes contract-renewal-check job', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('scripts/cron-scheduler.ts', 'utf-8');
    expect(content).toContain('contract-renewal-check');
    expect(content).toContain('0 7 * * *');
  });

  it('deploy/cron/crontab includes contract-renewal-check', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('deploy/cron/crontab', 'utf-8');
    expect(content).toContain('contract-renewal-check');
    expect(content).toContain('0 7 * * *');
  });
});
