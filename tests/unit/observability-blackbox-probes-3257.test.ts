/**
 * #3257 — nothing probed the data tier or the monitoring plane.
 *
 * `up{job="postgres"}` only says the postgres-exporter answered; it cannot see
 * that the app's connection is refused. And nothing watched Prometheus or
 * Alertmanager, so a dead monitoring plane looked exactly like a healthy one.
 *
 * The two silent ways to get the S3 probe wrong are asserted here because both
 * look green:
 *   - a default 2xx-only probe pages on a working gateway, whose unsigned
 *     `GET /` answers 403 AccessDenied;
 *   - a probe that accepts every status never pages at all.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

const ROOT = join(import.meta.dirname!, '..', '..');
const readYaml = (path: string) => YAML.parse(readFileSync(join(ROOT, path), 'utf8'));

const BLACKBOX = readYaml('deploy/monitoring/blackbox.yml');
const PROMETHEUS = readYaml('deploy/monitoring/prometheus.yml');
const ALERTS = readYaml('deploy/monitoring/alerts.yml');
const PROD_COMPOSE = readYaml('deploy/docker-compose.production.yml');
const ROOT_COMPOSE = readYaml('docker-compose.yml');

type Relabel = { source_labels?: string[]; target_label?: string; replacement?: string };
type Job = {
  job_name: string;
  metrics_path?: string;
  params?: { module?: string[] };
  static_configs?: Array<{ targets?: string[] }>;
  relabel_configs?: Relabel[];
};
type Rule = {
  alert: string;
  expr: string;
  for?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

const job = (name: string): Job =>
  PROMETHEUS.scrape_configs.find((j: Job) => j.job_name === name);
const probeJobs = (): Job[] =>
  PROMETHEUS.scrape_configs.filter((j: Job) => j.metrics_path === '/probe');
const targetsOf = (j: Job): string[] => (j.static_configs ?? []).flatMap((s) => s.targets ?? []);
const relabel = (j: Job, target: string): Relabel | undefined =>
  (j.relabel_configs ?? []).find((r) => r.target_label === target);

const observability = ALERTS.groups.find((g: { name: string }) => g.name === 'nucrm-observability');
const rules: Rule[] = observability?.rules ?? [];
const rule = (name: string): Rule | undefined => rules.find((r) => r.alert === name);

describe('blackbox modules (#3257)', () => {
  it('defines exactly the two modules Prometheus references', () => {
    expect(Object.keys(BLACKBOX.modules).sort()).toEqual(['s3-gateway', 'tcp']);
    const referenced = probeJobs().map((j) => j.params?.module?.[0]);
    expect(referenced.sort()).toEqual(['s3-gateway', 'tcp']);
  });

  it('treats 403 as a healthy S3 gateway response, but not as the only one', () => {
    const codes: number[] = BLACKBOX.modules['s3-gateway'].http.valid_status_codes;
    expect(codes).toContain(403); // unsigned GET / → AccessDenied is success
    expect(codes).toContain(200); // an anonymous-readable gateway is also success
    expect([...codes].sort((a, b) => a - b)).toEqual([200, 403]);
  });

  it('uses an HTTP prober for S3 and a TCP prober for raw sockets', () => {
    expect(BLACKBOX.modules['s3-gateway'].prober).toBe('http');
    expect(BLACKBOX.modules['s3-gateway'].http.method).toBe('GET');
    expect(BLACKBOX.modules.tcp.prober).toBe('tcp');
  });

  it('bounds every probe with a timeout, so one dead target cannot stall a scrape', () => {
    for (const [name, mod] of Object.entries(BLACKBOX.modules) as Array<[string, { timeout?: string }]>) {
      expect(mod.timeout, `${name} has no timeout`).toMatch(/^\d+s$/);
    }
  });
});

describe('Prometheus probes the dependency sockets (#3257)', () => {
  it('dials Postgres, Redis and the S3 port instead of trusting their exporters', () => {
    const tcp = job('blackbox-tcp');
    expect(tcp.params?.module).toEqual(['tcp']);
    expect(targetsOf(tcp)).toEqual(
      expect.arrayContaining(['host.docker.internal:5432', 'redis:6379', 'minio:9000']),
    );
  });

  it('probes the S3 gateway over HTTP with the 403-aware module', () => {
    const s3 = job('blackbox-s3');
    expect(s3.params?.module).toEqual(['s3-gateway']);
    expect(targetsOf(s3)).toEqual(['http://minio:9000/']);
  });

  it('rewrites __address__ to the exporter and keeps the probed target as instance', () => {
    for (const j of probeJobs()) {
      expect(relabel(j, '__param_target'), `${j.job_name}: __param_target`).toMatchObject({
        source_labels: ['__address__'],
      });
      expect(relabel(j, 'instance'), `${j.job_name}: instance`).toMatchObject({
        source_labels: ['__param_target'],
      });
      expect(relabel(j, '__address__'), `${j.job_name}: __address__`).toMatchObject({
        replacement: 'blackbox-exporter:9115',
      });
    }
  });

  it('never lists the exporter itself as a probed target', () => {
    for (const j of probeJobs()) {
      expect(targetsOf(j).join(',')).not.toContain('blackbox-exporter');
    }
  });
});

describe('the exporter is actually deployed (#3257)', () => {
  const deployments = [
    { label: 'root compose', doc: ROOT_COMPOSE, mount: './deploy/monitoring/blackbox.yml' },
    { label: 'production compose', doc: PROD_COMPOSE, mount: './monitoring/blackbox.yml' },
  ];

  for (const { label, doc, mount } of deployments) {
    it(`${label} runs blackbox-exporter with the module file and host-gateway`, () => {
      const svc = doc.services['blackbox-exporter'];
      expect(svc, `${label} has no blackbox-exporter service`).toBeDefined();
      expect(svc.image).toMatch(/^prom\/blackbox-exporter:/);
      expect(svc.volumes).toContain(
        `${mount}:/etc/blackbox_exporter/blackbox.yml:ro`,
      );
      // Postgres runs on the host; without this alias the probe fails DNS.
      expect(svc.extra_hosts).toContain('host.docker.internal:host-gateway');
    });
  }

  it('probes ports the production compose actually publishes', () => {
    expect(PROD_COMPOSE.services.redis.ports).toContain('127.0.0.1:6379:6379');
    expect(PROD_COMPOSE.services.minio.ports).toContain('127.0.0.1:9000:9000');
  });
});

describe('the monitoring plane is watched (#3257)', () => {
  it('adds a nucrm-observability group without duplicating an alert name', () => {
    expect(observability, 'nucrm-observability group is missing').toBeDefined();
    const names = ALERTS.groups.flatMap((g: { rules: Rule[] }) => g.rules.map((r) => r.alert));
    expect(new Set(names).size).toBe(names.length);
  });

  it('pages when a dependency probe cannot open the socket', () => {
    const r = rule('DependencyProbeFailing')!;
    expect(r.expr).toContain('probe_success');
    expect(r.expr).toMatch(/blackbox-\(tcp\|s3\)/);
    expect(r.labels?.severity).toBe('critical');
    expect(r.for).toBe('2m');
  });

  it('scrapes Prometheus and Alertmanager, so their absence is visible', () => {
    expect(job('prometheus'), 'no self-scrape job').toBeDefined();
    expect(job('alertmanager'), 'no alertmanager scrape job').toBeDefined();
    expect(rule('PrometheusScrapeFailing')?.expr).toContain('up{job="prometheus"}');
    expect(rule('AlertmanagerDown')?.expr).toContain('up{job="alertmanager"}');
  });

  it('keeps an always-firing dead-man switch for total Prometheus death', () => {
    const watchdog = rule('Watchdog')!;
    expect(watchdog.expr).toBe('vector(1)');
    expect(watchdog.for).toBeUndefined();
  });

  it('gives every rule a severity, a summary and a duration', () => {
    for (const g of ALERTS.groups as Array<{ rules: Rule[] }>) {
      for (const r of g.rules) {
        expect(r.labels?.severity, `${r.alert} has no severity`).toBeTruthy();
        expect(r.annotations?.summary, `${r.alert} has no summary`).toBeTruthy();
        if (r.alert !== 'Watchdog') {
          expect(r.for, `${r.alert} has no for:`).toMatch(/^\d+[mhd]$/);
        }
      }
    }
  });
});
