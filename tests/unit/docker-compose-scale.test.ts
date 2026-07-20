import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

let content: string;

beforeAll(() => {
  content = readFileSync(join(process.cwd(), 'docker-compose.scale.yml'), 'utf-8');
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