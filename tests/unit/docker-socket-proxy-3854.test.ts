import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROD = readFileSync(join(process.cwd(), 'deploy/docker-compose.production.yml'), 'utf8');
const PREPROD = readFileSync(join(process.cwd(), 'deploy/docker-compose.preprod.yml'), 'utf8');
const DEV = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8');
const CONFIG = readFileSync(join(process.cwd(), 'deploy/monitoring/promtail/promtail-config.yml'), 'utf8');

function serviceBlock(src: string, name: string): string {
  const start = src.indexOf(`  ${name}:\n`);
  expect(start, `${name} service missing`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf('\n  [A-Za-z]', start + 1);
  return end === -1 ? src.slice(start) : src.slice(start, end);
}

describe('promtail no longer holds the raw Docker socket (#3854)', () => {
  for (const [name, src] of [['production', PROD], ['dev', DEV]] as const) {
    const promtail = serviceBlock(src, 'promtail');
    it(`${name} promtail has no direct socket mount`, () => {
      expect(promtail).not.toContain('/var/run/docker.sock');
      expect(promtail).toContain('DOCKER_HOST: tcp://docker-socket-proxy:2375');
      expect(promtail).toContain('--config.expand-env=true');
      expect(promtail).toContain('docker-socket-proxy');
    });

    it(`${name} proxy exposes only read endpoints by digest`, () => {
      const proxy = serviceBlock(src, 'docker-socket-proxy');
      expect(proxy).toMatch(/image: tecnativa\/docker-socket-proxy@sha256:[0-9a-f]{64}/);
      expect(proxy).toContain('/var/run/docker.sock:/var/run/docker.sock:ro');
      for (const key of ['CONTAINERS: "1"', 'INFO: "1"', 'EVENTS: "1"']) {
        expect(proxy, `${key} must be enabled`).toContain(key);
      }
      for (const key of ['POST: "0"', 'PUT: "0"', 'DELETE: "0"', 'PATCH: "0"', 'EXEC: "0"', 'BUILD: "0"', 'SWARM: "0"']) {
        expect(proxy, `${key} must be disabled`).toContain(key);
      }
    });
  }

  it('preprod override drops the inherited socket mount', () => {
    const promtail = serviceBlock(PREPROD, 'promtail');
    expect(promtail).not.toContain('/var/run/docker.sock');
  });

  it('promtail config resolves the socket host from the environment', () => {
    expect(CONFIG).toContain('- host: ${DOCKER_HOST}');
    expect(CONFIG).not.toContain('unix:///var/run/docker.sock');
  });
});
