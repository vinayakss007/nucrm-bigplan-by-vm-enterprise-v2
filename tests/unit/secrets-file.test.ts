import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { materializeFileSecrets, DEFAULT_SECRETS_DIR } from '@/lib/secrets-file';

const dirs: string[] = [];

function makeSecretsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(`${tmpdir()}/secrets-test-`);
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(`${dir}/${name}`, content);
  }
  return dir;
}

const TEST_VARS = ['JWT_SECRET', 'DATABASE_URL', 'CRON_SECRET', 'REDIS_PASSWORD', 'S3_SECRET_KEY'];

afterEach(() => {
  delete process.env.SECRETS_DIR;
  for (const v of TEST_VARS) delete process.env[v];
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('materializeFileSecrets (#2123)', () => {
  it('is a no-op when the secrets directory does not exist', () => {
    process.env.SECRETS_DIR = '/nonexistent-secrets-dir';
    expect(materializeFileSecrets()).toEqual([]);
  });

  it('defaults to /run/secrets', () => {
    expect(DEFAULT_SECRETS_DIR).toBe('/run/secrets');
  });

  it('maps file names to env vars and trims trailing newlines', () => {
    process.env.SECRETS_DIR = makeSecretsDir({
      jwt_secret: 'super-secret-value\n',
      'database-url': 'postgres://u:p@h:5432/db\n',
    });
    const applied = materializeFileSecrets();
    expect(applied).toEqual(expect.arrayContaining(['JWT_SECRET', 'DATABASE_URL']));
    expect(process.env.JWT_SECRET).toBe('super-secret-value');
    expect(process.env.DATABASE_URL).toBe('postgres://u:p@h:5432/db');
  });

  it('never overrides an existing non-empty env value', () => {
    process.env.JWT_SECRET = 'from-env';
    process.env.SECRETS_DIR = makeSecretsDir({ jwt_secret: 'from-file' });
    const applied = materializeFileSecrets();
    expect(applied).not.toContain('JWT_SECRET');
    expect(process.env.JWT_SECRET).toBe('from-env');
  });

  it('fills a variable that is set but empty', () => {
    process.env.JWT_SECRET = '';
    process.env.SECRETS_DIR = makeSecretsDir({ jwt_secret: 'from-file' });
    expect(materializeFileSecrets()).toContain('JWT_SECRET');
    expect(process.env.JWT_SECRET).toBe('from-file');
  });

  it('skips directories and empty files', () => {
    const dir = makeSecretsDir({ cron_secret: '' });
    mkdirSync(`${dir}/nested`);
    expect(materializeFileSecrets()).toEqual([]);
  });
});
