import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveSeedPassword, SEED_PASSWORD_ENV } from '../../scripts/seed/credential';

const ROOT = join(import.meta.dirname!, '../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const DEBUG = 'scripts/_debug-create-admin.ts';
const E2E = 'scripts/seed-e2e-user.ts';

describe('seed scripts resolve the super-admin password from the environment (#4017)', () => {
  it.each([DEBUG, E2E])('%s contains no committed password literal', (rel) => {
    const source = read(rel);
    expect(source).not.toMatch(/DebugPass123456!|admin123|password123/);
  });

  it.each([DEBUG, E2E])('%s imports and calls resolveSeedPassword and exits on error', (rel) => {
    const source = read(rel);
    expect(source).toContain('resolveSeedPassword');
    expect(source).toContain('from \'./seed/credential\'');
    expect(source).toContain('credential.error');
    expect(source).toContain('process.exit(1)');
  });

  it('passes the resolved password to hashPassword in both scripts', () => {
    expect(read(DEBUG)).toContain('hashPassword(password)');
    expect(read(E2E)).toContain('hashPassword(PASSWORD)');
    expect(read(DEBUG)).toContain('const password = credential.password');
    expect(read(E2E)).toContain('const PASSWORD = credential.password');
  });

  it('does not echo the e2e super-admin password', () => {
    const source = read(E2E);
    expect(source).not.toContain('Password: ${PASSWORD}');
    expect(source).toContain('(not printed)');
  });

  it('refuses to run without SEED_PASSWORD', () => {
    const result = resolveSeedPassword({});
    expect(result.password).toBeNull();
    expect(result.error).toContain(SEED_PASSWORD_ENV);
  });

  it('accepts a policy-compliant password from the environment', () => {
    const result = resolveSeedPassword({ SEED_PASSWORD: 'Str0ng-Seed-Password!' });
    expect(result.error).toBeNull();
    expect(result.password).toBe('Str0ng-Seed-Password!');
  });
});
