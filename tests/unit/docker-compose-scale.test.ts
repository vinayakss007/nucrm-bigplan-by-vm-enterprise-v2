import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

let content: string;

beforeAll(() => {
  content = readFileSync(join(process.cwd(), 'docker-compose.scale.yml'), 'utf-8');
});

describe.each([
  'docker-compose.yml',
  'docker-compose.scale.yml',
  'deploy/docker-compose.production.yml',
  'deploy/docker-compose.preprod.yml',
])('%s queue persistence', (file) => {
  it('rejects writes at the memory limit instead of evicting queued jobs', () => {
    const compose = readFileSync(join(process.cwd(), file), 'utf-8');
    const redis = compose.match(/^  redis:\n([\s\S]*?)(?=^  [a-zA-Z][\w-]*:|^\S|(?![\s\S]))/m)?.[1];
    expect(redis).toBeDefined();
    expect(redis).toMatch(/^\s+--maxmemory-policy noeviction\s*$/m);
    expect(redis).not.toMatch(/^\s+--maxmemory-policy (?!noeviction\b)\S+/m);
    expect(redis).toMatch(/^\s+--appendonly yes\s*$/m);
  });
});

describe('docker-compose.scale.yml', () => {
  it('defaults DATABASE_SSL to true for both the web and worker services', () => {
    const matches = content.match(/DATABASE_SSL=\$\{DATABASE_SSL:-true\}/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  it('no longer defaults DATABASE_SSL to false anywhere in the file', () => {
    expect(content).not.toMatch(/DATABASE_SSL:-false/);
  });

  it('quotes the compose file version as a string literal', () => {
    expect(content).toMatch(/^version:\s*"3\.9"\s*$/m);
  });

  it('keeps the nginx and web healthchecks pointed at their expected endpoints', () => {
    expect(content).toContain('http://localhost/health');
    expect(content).toContain('http://localhost:3000/api/health');
  });

  it('keeps CPU limits quoted as strings for the web, worker, postgres and redis services', () => {
    const cpuLimitMatches = content.match(/cpus:\s*"[^"]+"/g) ?? [];
    expect(cpuLimitMatches.length).toBeGreaterThanOrEqual(6);
  });
});