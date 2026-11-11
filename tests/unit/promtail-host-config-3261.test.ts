/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

// #3261 — promtail-config.yml discovers targets through the Docker socket, so a
// rootless-Podman or pm2 host starts the pipeline and scrapes nothing. The host
// variant must be committed, must not depend on Docker, and must put every log
// path in the `__path__` label: promtail treats `targets:` as network addresses
// and silently drops a path written there (`no path for target`). These tests
// pin the file's shape so a later "tidy-up" cannot reintroduce the trap.

const ROOT = join(import.meta.dirname!, '..', '..');
const HOST_PATH = join(ROOT, 'deploy/monitoring/promtail/promtail-config.host.yml');
const DOCKER_PATH = join(ROOT, 'deploy/monitoring/promtail/promtail-config.yml');
const HOST = readFileSync(HOST_PATH, 'utf8');
const DOCKER = readFileSync(DOCKER_PATH, 'utf8');
const cfg = YAML.parse(HOST) as {
  clients: Array<{ url: string }>;
  scrape_configs: Array<{
    job_name: string;
    docker_sd_configs?: unknown;
    static_configs?: Array<{ targets?: string[]; labels?: Record<string, string> }>;
  }>;
};

describe('promtail host config exists and is independent of Docker (#3261)', () => {
  it('ships the host variant next to the Docker one', () => {
    expect(HOST).toContain('#3261');
    expect(HOST).not.toMatch(/docker_sd_configs/);
    expect(HOST).not.toMatch(/\/var\/run\/docker\.sock/);
  });

  it('does not declare a docker_sd job in the parsed config', () => {
    for (const job of cfg.scrape_configs) {
      expect(job.docker_sd_configs, `${job.job_name} still asks Docker for targets`).toBeUndefined();
    }
  });

  it('pushes to Loki over the loopback port a host process can reach', () => {
    expect(cfg.clients?.[0]?.url).toBe('http://127.0.0.1:3100/loki/api/v1/push');
  });
});

describe('host log paths live in __path__ labels, never in targets (#3261)', () => {
  const statics = cfg.scrape_configs.flatMap((job) =>
    (job.static_configs ?? []).map((s) => ({ job: job.job_name, ...s })),
  );

  it('has at least one static target per job', () => {
    expect(cfg.scrape_configs.length).toBeGreaterThan(0);
    for (const job of cfg.scrape_configs) {
      expect(job.static_configs?.length, `${job.job_name} has no static_configs`).toBeGreaterThan(0);
    }
  });

  it('gives every static_config a __path__ label that names a log glob', () => {
    expect(statics.length).toBeGreaterThan(0);
    for (const s of statics) {
      expect(s.labels?.__path__, `${s.job} has no __path__ label`).toMatch(/\.log$/);
      expect(s.labels?.job, `${s.job} static_config has no job label`).toBeTruthy();
    }
  });

  it('never writes a filesystem path under targets — promtail drops those', () => {
    for (const s of statics) {
      for (const target of s.targets ?? []) {
        expect(target, `${s.job} puts a path in targets: ${target}`).not.toContain('/');
      }
    }
  });

  it('covers application and nginx logs', () => {
    const paths = statics.map((s) => s.labels?.__path__).join('\n');
    expect(paths).toMatch(/\/srv\/nucrm\/logs\/\*\.log/);
    expect(paths).toMatch(/\/var\/log\/nginx\/\*\.log/);
  });
});

describe('the Docker config points at the host variant (#3261)', () => {
  it('names promtail-config.host.yml for non-Docker hosts', () => {
    expect(DOCKER).toMatch(/promtail-config\.host\.yml/);
  });
});
