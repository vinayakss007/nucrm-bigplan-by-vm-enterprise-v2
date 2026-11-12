/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3272 — which deployment model is this host actually running?
 *
 * `deploy/DEPLOYMENT_PATHS.md` names two topologies:
 *
 *   Path A — production: pm2 owns `web`/`worker`/`cron`/`realtime` on the host,
 *            and Docker runs only the data + monitoring tier.
 *   Path B — development: the root `docker-compose.yml` runs the app and worker
 *            as containers.
 *
 * A checked-out tree contains both `ecosystem.config.cjs` and
 * `docker-compose.yml`, so a file on disk proves nothing about the running
 * host. This module asks the processes instead: `pm2 jlist` for Path A and
 * `docker ps` (with the Compose service label) for Path B. It is deliberately
 * pure — the caller supplies the two command outputs — so detection is testable
 * without either runtime.
 *
 * Both running at once is a hard failure, not a preference: the two paths bind
 * the same app port, and the repo says so at the top of DEPLOYMENT_PATHS.md.
 */

/** pm2 names that mean "this host runs the app under pm2". */
export const PM2_APP_NAMES = ['web', 'nucrm-prod', 'worker', 'cron', 'realtime'];

/** Compose services that mean "this host runs the app in a container". */
export const COMPOSE_APP_SERVICES = ['app', 'web'];

/**
 * `pm2 jlist` -> the app processes that are actually online.
 *
 * A stopped or errored process is not evidence of a running topology, and an
 * unparseable answer is not evidence of anything — both return [].
 */
export function parsePm2Jlist(json) {
  let apps;
  try {
    apps = JSON.parse(String(json ?? ''));
  } catch {
    return [];
  }
  if (!Array.isArray(apps)) return [];
  return apps
    .map((app) => ({
      name: String(app?.name ?? ''),
      status: String(app?.pm2_env?.status ?? app?.status ?? ''),
    }))
    .filter((app) => app.name && app.status === 'online');
}

/**
 * `docker ps --format '{{.Names}}|{{.Label "com.docker.compose.service"}}'`
 * -> the containers Docker Compose owns. A container without the label (a
 * `docker run`, the database, a sidecar) is not the app topology.
 */
export function parseDockerComposePs(text) {
  const rows = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const [name, service = ''] = line.split('|');
    if (name && name.trim()) rows.push({ name: name.trim(), service: service.trim() });
  }
  return rows;
}

/**
 * Classify the host. `pm2Json`/`dockerPs` are the raw command outputs, or null
 * when the command could not be run (pm2/docker absent).
 */
export function detectTopology({ pm2Json = null, dockerPs = null } = {}) {
  const pm2 = parsePm2Jlist(pm2Json).filter((app) => PM2_APP_NAMES.includes(app.name));
  const compose = parseDockerComposePs(dockerPs).filter((container) =>
    COMPOSE_APP_SERVICES.includes(container.service),
  );

  // deploy.yml discovers `nucrm-prod` first, then `web`; either one runs the
  // Next server and is the environment a preflight should read.
  const pm2App = ['nucrm-prod', 'web'].find((name) => pm2.some((app) => app.name === name)) ?? null;

  if (pm2.length > 0 && compose.length > 0) {
    return {
      kind: 'both',
      pm2,
      compose,
      pm2App,
      detail:
        `pm2 is running ${pm2.map((app) => app.name).join(', ')}; `
        + `Compose is running ${compose.map((c) => c.name).join(', ')}`,
    };
  }
  if (pm2.length > 0) {
    return {
      kind: 'pm2',
      pm2,
      compose: [],
      pm2App,
      detail: pm2App
        ? `pm2 is running ${pm2.map((app) => app.name).join(', ')}`
        : `pm2 is running ${pm2.map((app) => app.name).join(', ')} but no Next app (nucrm-prod/web) is online`,
    };
  }
  if (compose.length > 0) {
    return {
      kind: 'compose',
      pm2: [],
      compose,
      pm2App: null,
      detail: `Compose is running ${compose.map((c) => `${c.name} (service ${c.service})`).join(', ')}`,
    };
  }
  return {
    kind: 'unknown',
    pm2: [],
    compose: [],
    pm2App: null,
    detail: 'no pm2 app and no Compose app container is running',
  };
}

/**
 * Run the two commands and classify. A command that cannot run (not installed,
 * not permitted) is "absent", never a guess: the caller gets `unknown` and can
 * say so.
 */
export function detectHostTopology(runCommand) {
  const read = (cmd, args) => {
    try {
      return runCommand(cmd, args);
    } catch {
      return null;
    }
  };
  return detectTopology({
    pm2Json: read('pm2', ['jlist']),
    dockerPs: read('docker', [
      'ps',
      '--format',
      '{{.Names}}|{{.Label "com.docker.compose.service"}}',
    ]),
  });
}

/** The human-readable report `--auto-source` prints before it reads an env. */
export function formatTopology(report) {
  const lines = [`deployment topology: ${report.kind}`];
  if (report.kind === 'pm2') {
    lines.push('  path: Path A — production (pm2 on the host; Docker for the data tier)');
    lines.push(`  pm2: ${report.pm2.map((app) => app.name).join(', ')}`);
    lines.push(`  env source: pm2 jlist -> "${report.pm2App ?? '(no Next app online)'}"`);
  } else if (report.kind === 'compose') {
    lines.push('  path: Path B — Docker Compose (development; not production)');
    lines.push(`  compose: ${report.compose.map((c) => `${c.name} (${c.service})`).join(', ')}`);
    lines.push('  env source: the app container (run the assertion inside it)');
  } else if (report.kind === 'both') {
    lines.push('  path: BOTH — refusing; the two paths must never run on one host');
  } else {
    lines.push('  path: unknown — no pm2 app and no Compose app container');
    lines.push('  env source: the repository env files (pre-start reading)');
  }
  lines.push(`  detail: ${report.detail}`);
  lines.push('  canonical: deploy/DEPLOYMENT_PATHS.md');
  return lines.join('\n');
}
