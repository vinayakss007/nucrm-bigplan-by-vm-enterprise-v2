/**
 * #3263 — the PM2 topology's edge aliases.
 *
 * The shipped nginx config proxies to `app:3000` / `realtime:4001`, and the
 * Prometheus `nucrm-app` job resolves `app`. Those are Docker Compose service
 * names. On the PM2 topology (deploy/DEPLOYMENT_PATHS.md, Path A) the app and
 * realtime are host processes, so the names resolve to nothing inside a
 * container: the edge answers 502 and the scrape job reports zero targets.
 *
 * The repo chose the alias fix (#3263's option 1): a compose override maps the
 * names the configs already use to the host gateway, and a provisioning script
 * applies it with `--no-deps` and verifies the result from inside the
 * containers. This file is the ratchet for that decision:
 *
 *   - the override covers every hostname the two configs actually use;
 *   - the aliases live in the override, never in the base compose file, because
 *     `extra_hosts` wins over Docker DNS and would shadow the real services;
 *   - the script refuses the compose topology and proves reachability from
 *     inside nginx instead of trusting the host's own `curl 127.0.0.1`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const ROOT = join(import.meta.dirname!, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

type Compose = {
  services: Record<string, { extra_hosts?: string[] }>;
};

const base = parse(read('deploy/docker-compose.production.yml')) as Compose;
const edge = parse(read('deploy/docker-compose.pm2-edge.yml')) as Compose;
const nginxConf = read('deploy/nginx/nginx-production.conf');
const prometheus = parse(read('deploy/monitoring/prometheus.yml')) as {
  scrape_configs: {
    job_name: string;
    dns_sd_configs?: { names: string[] }[];
    static_configs?: { targets: string[] }[];
  }[];
};
const script = read('deploy/scripts/provision-pm2-edge.sh');
const docs = read('deploy/DEPLOYMENT_PATHS.md');

const hostOf = (entry: string) => entry.split(':')[0];
const hosts = (service: string) => (edge.services[service]?.extra_hosts ?? []).map(hostOf);

/** Every hostname the two shipped configs ask Docker to resolve. */
const configuredHosts = (() => {
  const used = new Set<string>();
  for (const m of nginxConf.matchAll(/server\s+([a-z][\w.-]*):\d+/g)) used.add(m[1]);
  const appJob = prometheus.scrape_configs.find((j) => j.job_name === 'nucrm-app');
  expect(appJob, 'the nucrm-app scrape job is what #3263 is about').toBeDefined();
  for (const dns of appJob!.dns_sd_configs ?? []) for (const n of dns.names) used.add(n);
  for (const cfg of appJob!.static_configs ?? []) {
    for (const target of cfg.targets) used.add(hostOf(target));
  }
  return [...used].sort();
})();

describe('#3263 the PM2 edge aliases', () => {
  it('maps the names the shipped configs use to the host gateway', () => {
    expect(hosts('nginx')).toEqual(expect.arrayContaining(['app', 'realtime']));
    expect(hosts('prometheus')).toEqual(expect.arrayContaining(['app']));
    for (const service of ['nginx', 'prometheus']) {
      for (const entry of edge.services[service]?.extra_hosts ?? []) {
        expect(entry, `${service}: ${entry}`).toMatch(/^[a-z][\w.-]*:host-gateway$/);
      }
    }
  });

  it('covers every hostname the configs actually ask for', () => {
    // `realtime` comes from the nginx upstream; `app` from nginx and the
    // nucrm-app job. If a config starts using another name, this fails rather
    // than leaving the edge with a host it cannot resolve.
    expect(configuredHosts).toEqual(['app', 'realtime']);
    const aliased = new Set([...hosts('nginx'), ...hosts('prometheus')]);
    const composeServices = new Set(Object.keys(base.services));
    expect(configuredHosts.filter((h) => !composeServices.has(h) && !aliased.has(h))).toEqual([]);
  });

  it('keeps the aliases out of the base compose file', () => {
    // extra_hosts writes /etc/hosts, which wins over Docker DNS. Putting these
    // in the base file would route the compose app/realtime containers to the
    // host instead of to the services with those names.
    for (const service of ['nginx', 'prometheus']) {
      const baseHosts = (base.services[service]?.extra_hosts ?? []).map(hostOf);
      expect(baseHosts, service).not.toContain('app');
      expect(baseHosts, service).not.toContain('realtime');
    }
  });

  it('is applied by a script that refuses the compose topology', () => {
    expect(script).toMatch(/docker compose -f "\$BASE" ps -q app/);
    expect(script).toMatch(/refusing: the compose 'app' service is running/);
    // --no-deps is what keeps `depends_on: app` from starting a second app on
    // port 3000; the override only recreates the two containers that need it.
    expect(script).toMatch(
      /docker compose -f "\$BASE" -f "\$OVERRIDE" up -d --no-deps --force-recreate nginx prometheus/,
    );
  });

  it('proves the alias from inside nginx, not from the host', () => {
    expect(script).toMatch(/docker exec nucrm-nginx getent hosts app/);
    expect(script).toMatch(/docker exec nucrm-nginx nginx -t/);
    expect(script).toMatch(/docker exec nucrm-nginx wget .*http:\/\/app:\$\{APP_PORT\}\/api\/health/);
    // The host-side probe is necessary but not sufficient, and the failure
    // message names the real cause: a loopback-only PM2 bind.
    expect(script).toMatch(/NUCRM_HOST=0\.0\.0\.0/);
  });

  it('is executable and syntax-checks as bash', () => {
    expect(statSync(join(ROOT, 'deploy/scripts/provision-pm2-edge.sh')).mode & 0o111).not.toBe(0);
  });

  it('records the decision where an operator looks for the topology', () => {
    expect(docs).toContain('#3263');
    expect(docs).toContain('deploy/docker-compose.pm2-edge.yml');
    expect(docs).toContain('provision-pm2-edge.sh');
    expect(docs).toContain('host-gateway');
    expect(docs).toMatch(/NUCRM_HOST=0\.0\.0\.0/);
    // The decision the issue asked for: alias, not templating.
    expect(docs).toContain('The repo\'s decision is the **alias** fix');
  });

  it('names the override in both config headers', () => {
    expect(nginxConf).toMatch(/#3263[\s\S]{0,400}provision-pm2-edge\.sh/);
    const raw = read('deploy/monitoring/prometheus.yml');
    expect(raw).toMatch(/#3263:[\s\S]{0,300}provision-pm2-edge\.sh/);
  });
});
