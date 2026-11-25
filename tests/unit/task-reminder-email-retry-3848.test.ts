import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'app/api/cron/task-reminders/route.ts'), 'utf8');
const start = src.indexOf('for (const task of overdue)');
const end = src.indexOf('\n    });', start);
const loop = src.slice(start, end);

describe('task-reminders withholds the marker when email fails (#3848)', () => {
  it('sends the day-1 email before writing the notification marker', () => {
    const emailIdx = loop.indexOf('const emailResult = await sendEmail(');
    const notificationIdx = loop.indexOf('await createNotification(');
    expect(emailIdx).toBeGreaterThanOrEqual(0);
    expect(notificationIdx).toBeGreaterThan(emailIdx);
  });

  it('continues past the marker write on a rejected send', () => {
    const rejectionIdx = loop.indexOf('if (!emailResult.success)');
    const continueIdx = loop.indexOf('continue;', rejectionIdx);
    const notificationIdx = loop.indexOf('await createNotification(');
    expect(rejectionIdx).toBeGreaterThanOrEqual(0);
    expect(continueIdx).toBeGreaterThan(rejectionIdx);
    expect(continueIdx).toBeLessThan(notificationIdx);
  });

  it('only adds the dedup marker after a delivered notification', () => {
    expect(loop).toContain('if (overdueDelivered) { notified++; remindedKeys.add(marker); }');
  });

  it('counts failures and reports a rejected run', () => {
    expect(src).toContain('let emailFailed = 0;');
    expect(src).toContain('emailFailed++;');
    expect(src).toContain('ok: sweep.failed.length === 0 && notifyFailed === 0 && emailFailed === 0');
    expect(src).toContain('email_failed: emailFailed');
  });
});
