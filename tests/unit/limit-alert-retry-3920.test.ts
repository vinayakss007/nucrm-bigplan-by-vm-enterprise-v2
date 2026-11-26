import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'lib/usage/notifications.ts'), 'utf8');

describe('limit alerts retry when the email channel rejects (#3920)', () => {
  it('awaits the email result instead of a dead .catch-style .then', () => {
    expect(src).toContain('const emailResult = await sendEmail(');
    expect(src).not.toMatch(/void sendEmail\(\{/);
  });

  it('resets the notified marker when the send was rejected', () => {
    expect(src).toContain('if (!emailResult.success)');
    expect(src).toContain('set({ notified: false, notifiedAt: null })');
    expect(src).toContain('eq(limitViolations.id, updated[0]!.id)');
    expect(src).toContain('eq(limitViolations.notified, true)');
  });
});
