import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const executor = readFileSync(join(process.cwd(), 'lib/automation/workflow-executor.ts'), 'utf8');
const engine = readFileSync(join(process.cwd(), 'lib/automation/engine.ts'), 'utf8');

describe('workflow actions only log success when they succeeded (#3922)', () => {
  it('fails the action when the notification was not persisted', () => {
    expect(executor).toContain("if (!stored) throw new Error('notification was not persisted');");
    expect(engine).toContain("actionFailures.push('send_notification: notification was not persisted')");
  });

  it('fails the action when a webhook answers non-2xx', () => {
    expect(executor).toContain('const res = await safeFetch(');
    expect(executor).toContain('if (!res.ok) throw new Error(`webhook returned HTTP ${res.status}`);');
  });

  it('no longer treats an unknown action type as success', () => {
    expect(executor).toContain("throw new Error(`Unknown workflow action type: ${actionType}`)");
    expect(executor).not.toContain('console.warn(`[workflow] Unknown action type');
  });
});
