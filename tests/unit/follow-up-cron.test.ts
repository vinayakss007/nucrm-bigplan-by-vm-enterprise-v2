import { describe, it, expect } from 'vitest';

describe('Cron jobs registration', () => {
  it('detect-missed-followups and ai-auto-followup are registered in cron-scheduler.ts', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('scripts/cron-scheduler.ts', 'utf-8');
    expect(content).toContain('detect-missed-followups');
    expect(content).toContain('ai-auto-followup');
    expect(content).toContain('*/30 * * * *');
    expect(content).toContain('30 * 60_000');
    expect(content).toContain('60 * 60_000');
  });

  it('detect-missed-followups and ai-auto-followup are registered in crontab', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('deploy/cron/crontab', 'utf-8');
    expect(content).toContain('detect-missed-followups');
    expect(content).toContain('ai-auto-followup');
    expect(content).toContain('*/30 * * * *');
    expect(content).toContain('0 * * * *');
  });

  it('follow-ups list page includes pagination and new follow-up button', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('app/tenant/follow-ups/page.tsx', 'utf-8');
    expect(content).toContain('New Follow-up');
    expect(content).toContain('Previous');
    expect(content).toContain('Next');
    expect(content).toContain('offset');
    expect(content).toContain('totalPages');
    expect(content).toContain('assigneeName');
  });

  it('missed follow-ups page no longer fetches or passes unused teamMembers', async () => {
    const fs = await import('fs');
    const pageContent = fs.readFileSync('app/tenant/follow-ups/missed/page.tsx', 'utf-8');
    const clientContent = fs.readFileSync('app/tenant/follow-ups/missed/missed-followups-client.tsx', 'utf-8');
    expect(pageContent).not.toContain('teamMembers');
    expect(clientContent).not.toContain('teamMembers');
    expect(clientContent).not.toContain('_teamMembers');
  });
});
