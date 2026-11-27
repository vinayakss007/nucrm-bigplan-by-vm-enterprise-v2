import { spawnSync } from 'child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

describe('launch gate toolchain precheck', () => {
  it('fails once with an actionable message when dependencies are not installed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'launch-gate-'));
    try {
      copyFileSync('scripts/launch-gate.sh', join(dir, 'launch-gate.sh'));
      const result = spawnSync('bash', ['launch-gate.sh'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, LAUNCH_GATE_STRICT: '0' },
      });
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

      expect(result.status).toBe(1);
      expect(output).toContain('TOOLCHAIN PRECHECK');
      expect(output).toContain('Missing installed tool(s)');
      expect(output).toContain('npm ci');
      expect(output).not.toContain('❌ Typecheck failed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
