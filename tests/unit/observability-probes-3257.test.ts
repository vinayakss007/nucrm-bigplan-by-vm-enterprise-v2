/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import YAML from "yaml";

/**
 * #3257 — the scrape config proved every process was running; nothing proved a
 * socket could be opened to Postgres, Redis or the S3 gateway, and nothing
 * watched Prometheus/Alertmanager themselves. These assertions keep the probes
 * pointed at the right place, keep the S3 probe's 403-as-healthy rule intact,
 * and keep `probe_success` from silently disappearing (the failure mode that
 * looks like "no data" instead of an outage).
 */

const ROOT = join(import.meta.dirname!, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const BLACKBOX = read("deploy/monitoring/blackbox.yml");
const PROMETHEUS = read("deploy/monitoring/prometheus.yml");
const ALERTS = read("deploy/monitoring/alerts.yml");
const COMPOSE = read("docker-compose.yml");
const PROD_COMPOSE = read("deploy/docker-compose.production.yml");

type BlackboxModule = {
  prober?: string;
  http?: { valid_status_codes?: number[] };
};
type Job = {
  job_name: string;
  metrics_path?: string;
  params?: Record<string, string[]>;
  static_configs?: { targets: string[]; labels?: Record<string, string> }[];
  relabel_configs?: {
    source_labels?: string[];
    target_label?: string;
    replacement?: string;
  }[];
};
type Rule = {
  alert?: string;
  expr?: string;
  for?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

const blackbox = YAML.parse(BLACKBOX) as {
  modules: Record<string, BlackboxModule>;
};
const prometheus = YAML.parse(PROMETHEUS) as { scrape_configs: Job[] };
const alerts = YAML.parse(ALERTS) as {
  groups: { name: string; rules: Rule[] }[];
};
const jobs = (name: string) =>
  prometheus.scrape_configs.filter((j) => j.job_name === name);

function serviceBlock(src: string, name: string): string {
  const m = src.match(
    new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-zA-Z][\\w-]*:|^\\S)`, "m"),
  );
  expect(m, `service block "${name}" not found`).not.toBeNull();
  return m![1];
}

describe("blackbox modules answer a real question (#3257)", () => {
  it("has a tcp module and an http S3 module", () => {
    expect(Object.keys(blackbox.modules).sort()).toEqual(["s3-gateway", "tcp"]);
    expect(blackbox.modules.tcp.prober).toBe("tcp");
    expect(blackbox.modules["s3-gateway"].prober).toBe("http");
  });

  it("accepts 403 as the healthy unsigned ListBuckets answer, not only 2xx", () => {
    // The trap: default valid_status_codes is 2xx, and an unsigned GET / on a
    // healthy gateway is 403. A 2xx-only probe pages on a working endpoint; an
    // "accept everything" probe never pages at all.
    const codes = blackbox.modules["s3-gateway"].http?.valid_status_codes;
    expect(codes).toContain(403);
    expect(codes).toContain(200);
    expect(codes).not.toContain(404);
  });
});

describe("prometheus gets a probe and a self-scrape (#3257)", () => {
  it("scrapes the blackbox exporter over /probe with the target in a parameter", () => {
    for (const name of ["blackbox-tcp", "blackbox-s3"]) {
      const [job] = jobs(name);
      expect(job, `${name} missing`).toBeDefined();
      expect(job.metrics_path).toBe("/probe");
      const moduleName = job.params?.module?.[0];
      expect(moduleName, `${name} has no module`).toBeTruthy();
      expect(
        blackbox.modules[moduleName!],
        `${name} names an unknown module`,
      ).toBeDefined();
      const relabel = job.relabel_configs ?? [];
      expect(
        relabel.some(
          (r) =>
            r.source_labels?.includes("__address__") &&
            r.target_label === "__param_target",
        ),
      ).toBe(true);
      expect(
        relabel.some(
          (r) =>
            r.target_label === "__address__" &&
            r.replacement === "blackbox-exporter:9115",
        ),
      ).toBe(true);
    }
  });

  it("probes the same Postgres/Redis/S3 endpoints the app talks to", () => {
    const targets = ["blackbox-tcp", "blackbox-s3"].flatMap((n) =>
      jobs(n).flatMap((j) =>
        (j.static_configs ?? []).flatMap((s) => s.targets),
      ),
    );
    expect(targets).toEqual(
      expect.arrayContaining(["postgres:5432", "redis:6379", "minio:9000"]),
    );
  });

  it("watches Prometheus itself, Alertmanager, and the blackbox exporter", () => {
    for (const name of ["prometheus", "alertmanager", "blackbox-exporter"]) {
      expect(jobs(name), `${name} self-scrape missing`).toHaveLength(1);
    }
  });
});

describe("the observability alert group names every silent failure (#3257)", () => {
  const group = () =>
    alerts.groups.find((g) => g.name === "nucrm-observability");
  const rule = (name: string) => group()?.rules.find((r) => r.alert === name);

  it("adds one group and does not duplicate an existing group name", () => {
    const names = alerts.groups.map((g) => g.name);
    expect(names).toContain("nucrm-observability");
    expect(new Set(names).size).toBe(names.length);
  });

  it("alerts when the exporter that owns probe_success is down", () => {
    expect(rule("BlackboxExporterDown")?.expr).toBe(
      'up{job="blackbox-exporter"} == 0',
    );
  });

  it("alerts on a failed probe and on the probes disappearing entirely", () => {
    expect(rule("DependencyProbeFailing")?.expr).toBe("probe_success == 0");
    // absent() is the half a `probe_success == 0` rule can never cover: with
    // no series there is no 0 to match, and the panels read "no data".
    expect(rule("DependencyProbesMissing")?.expr).toMatch(
      /absent\(probe_success\)/,
    );
  });

  it("watches the alert path and Prometheus rule evaluation", () => {
    expect(rule("AlertmanagerDown")?.expr).toBe('up{job="alertmanager"} == 0');
    expect(rule("PrometheusRuleEvaluationFailing")?.expr).toMatch(
      /prometheus_rule_evaluation_failures_total/,
    );
    expect(rule("PrometheusConfigReloadFailed")?.expr).toMatch(
      /prometheus_config_last_reload_successful/,
    );
  });

  it("gives every rule a severity and a summary a human can act on", () => {
    for (const r of group()?.rules ?? []) {
      expect(r.expr, `${r.alert} has no expr`).toBeTruthy();
      expect(r.labels?.severity, `${r.alert} has no severity`).toBeTruthy();
      expect(r.annotations?.summary, `${r.alert} has no summary`).toBeTruthy();
    }
  });
});

describe("the exporter is deployed on loopback in both composes (#3257)", () => {
  for (const [label, src, configPath] of [
    ["dev", COMPOSE, "./deploy/monitoring/blackbox.yml"],
    ["production", PROD_COMPOSE, "./monitoring/blackbox.yml"],
  ] as const) {
    describe(label, () => {
      const block = serviceBlock(src, "blackbox-exporter");

      it("mounts the committed module file", () => {
        expect(block).toContain(
          `${configPath}:/etc/blackbox_exporter/config.yml:ro`,
        );
      });

      it("publishes only on 127.0.0.1", () => {
        expect(block).toMatch(/"127\.0\.0\.1:9115:9115"/);
        expect(block).not.toMatch(/"0\.0\.0\.0:9115/);
        expect(block).not.toMatch(/^\s+- "9115:9115"/m);
      });
    });
  }

  it("maps postgres to the host gateway where production Postgres actually runs", () => {
    // prometheus.yml is shared, so the probe target must resolve in both
    // composes: service name in dev, host gateway in production.
    expect(serviceBlock(PROD_COMPOSE, "blackbox-exporter")).toContain(
      "postgres:host-gateway",
    );
  });
});
