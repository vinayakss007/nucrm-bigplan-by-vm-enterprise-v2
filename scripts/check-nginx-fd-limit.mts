/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * nginx file-descriptor limit guard (#3276).
 *
 * `worker_rlimit_nofile` is a REQUEST. nginx raises a worker's soft limit only as
 * far as the hard limit its supervisor granted the process, and when it cannot it
 * does not fail — it logs `setrlimit(RLIMIT_NOFILE, 65535) failed (13: Permission
 * denied)` once per worker and serves anyway, on 1024 fds per worker while the
 * config in review claims 65535. That is what happened on the host: the error log
 * said so four times and nothing read it.
 *
 * The number therefore lives in three places that have to agree, because they are
 * three deploy paths for one file:
 *
 *   - `deploy/nginx/nginx-production.conf` — the directive itself, mounted into
 *     the container and installed as `/etc/nginx/nginx.conf` on the host;
 *   - `deploy/systemd/nginx.service.d/limits.conf` — the grant for the host
 *     (packaged nginx in front of the pm2 app);
 *   - `deploy/docker-compose.production.yml` — the `ulimits:` block of the
 *     `nginx` service, which is the grant for the container path.
 *
 * Two more invariants come from nginx's own arithmetic: a proxied connection costs
 * two descriptors (client + upstream), so the limit has to cover
 * `2 * worker_connections` plus listeners, and `soft` must not exceed `hard`,
 * because compose accepts that shape and nginx then cannot raise the soft limit at
 * all. Both were true-by-accident here and false-by-silence in the failure case.
 *
 * Reporting is fail-closed on the environment, like #3381's and #3281's screens: a
 * missing or unparseable surface is a finding, never a skip — a screen that cannot
 * read the limits must not report "consistent".
 *
 * Usage: npm run guard:nginx-fd-limit [--json] [root]
 *   (root defaults to the repo; pass a fixture root from a test)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const SURFACES = {
  conf: 'deploy/nginx/nginx-production.conf',
  unit: 'deploy/systemd/nginx.service.d/limits.conf',
  compose: 'deploy/docker-compose.production.yml',
} as const;

export type SurfaceName = keyof typeof SURFACES;

export interface Finding {
  surface: SurfaceName | 'agreement';
  detail: string;
}

export interface Verdict {
  /** per-surface numbers this screen read; unset = no file, null = present but unparsable */
  values: Partial<Record<SurfaceName, number | null>>;
  /** descriptor cost of the conf's own `worker_connections` at 2 fds per proxy hop */
  connections: number | null;
  findings: Finding[];
}

/** `worker_rlimit_nofile 65535;` — the semicolon is part of the directive. */
export function parseWorkerRlimit(text: string): number | null {
  const m = text.match(/^\s*worker_rlimit_nofile\s+(\d+)\s*;/m);
  return m ? Number(m[1]) : null;
}

/** `worker_connections 4096;` inside the `events` block. */
export function parseWorkerConnections(text: string): number | null {
  const m = text.match(/^\s*worker_connections\s+(\d+)\s*;/m);
  return m ? Number(m[1]) : null;
}

/** `LimitNOFILE=65535` — systemd also spells the unlimited value `infinity`. */
export function parseLimitNofile(text: string): number | null {
  const m = text.match(/^\s*LimitNOFILE\s*=\s*(\d+)/m);
  return m ? Number(m[1]) : null;
}

/**
 * The `nginx` service's `ulimits.nofile.{soft,hard}`. Parsed as a block rather than
 * with a YAML library because none is installed, and the block shape is the one
 * tests/unit/docker-compose-scale.test.ts already relies on: two-space service keys
 * end the service.
 */
export function parseComposeUlimits(
  text: string,
): { soft: number | null; hard: number | null } | null {
  const nginxBlock = text.match(/^ {2}nginx:\n([\s\S]*?)(?=^ {2}[a-zA-Z][\w-]*:|^\S|(?![\s\S]))/m)?.[1];
  if (nginxBlock === undefined) return null;
  const ulimitsBlock = nginxBlock.match(/^\s{4}ulimits:\n([\s\S]*?)(?=^\s{4}\S|(?![\s\S]))/m)?.[1];
  if (ulimitsBlock === undefined) return { soft: null, hard: null };
  const nofileBlock = ulimitsBlock.match(/^\s{6}nofile:\n([\s\S]*?)(?=^\s{6}\S|(?![\s\S]))/m)?.[1];
  if (nofileBlock === undefined) return { soft: null, hard: null };
  const soft = nofileBlock.match(/^\s*soft:\s*(\d+)/m)?.[1];
  const hard = nofileBlock.match(/^\s*hard:\s*(\d+)/m)?.[1];
  return { soft: soft === undefined ? null : Number(soft), hard: hard === undefined ? null : Number(hard) };
}

export function check(root = ROOT): Verdict {
  const findings: Finding[] = [];
  const values: Verdict['values'] = {};
  let connections: number | null = null;

  const read = (name: SurfaceName): string | null => {
    const path = resolve(root, SURFACES[name]);
    if (!existsSync(path)) {
      findings.push({ surface: name, detail: `${SURFACES[name]} is missing` });
      return null;
    }
    return readFileSync(path, 'utf8');
  };

  const conf = read('conf');
  const unit = read('unit');
  const compose = read('compose');

  if (conf !== null) {
    values.conf = parseWorkerRlimit(conf);
    connections = parseWorkerConnections(conf);
    if (values.conf === null) {
      findings.push({ surface: 'conf', detail: 'no `worker_rlimit_nofile <n>;` directive to read' });
    }
    if (connections === null) {
      findings.push({ surface: 'conf', detail: 'no `worker_connections <n>;` directive to read' });
    }
  }

  if (unit !== null) {
    values.unit = parseLimitNofile(unit);
    if (values.unit === null) {
      findings.push({ surface: 'unit', detail: 'no `LimitNOFILE=<n>` in the drop-in' });
    }
  }

  if (compose !== null) {
    const ulimits = parseComposeUlimits(compose);
    if (ulimits === null) {
      // Only when the file *is* there: a missing compose file already reported itself,
      // and "no nginx service block" would blame the wrong thing.
      findings.push({ surface: 'compose', detail: 'no `  nginx:` service block to read' });
      values.compose = null;
    } else if (ulimits.soft === null || ulimits.hard === null) {
      findings.push({
        surface: 'compose',
        detail: `nginx ulimits.nofile is incomplete (soft=${ulimits.soft} hard=${ulimits.hard})`,
      });
      values.compose = ulimits.soft;
    } else {
      values.compose = ulimits.soft;
      if (ulimits.soft > ulimits.hard) {
        findings.push({
          surface: 'compose',
          detail: `soft ${ulimits.soft} exceeds hard ${ulimits.hard}; nginx cannot raise past the hard limit, so the directive is refused`,
        });
      }
    }
  }

  // Only surfaces this screen actually read a number from may disagree. A missing file
  // leaves its key unset (not null), and `undefined !== null` would let it into the
  // comparison and print `conf=undefined` as if it were a limit someone wrote down.
  const confValue = values.conf;
  const unitValue = values.unit;
  const composeValue = values.compose;
  if (
    typeof confValue === 'number' &&
    typeof unitValue === 'number' &&
    typeof composeValue === 'number' &&
    new Set([confValue, unitValue, composeValue]).size !== 1
  ) {
    findings.push({
      surface: 'agreement',
      detail: `three surfaces disagree: conf=${confValue} unit=${unitValue} compose.soft=${composeValue}`,
    });
  }

  // nginx's own arithmetic: a proxied connection holds two descriptors.
  if (typeof confValue === 'number' && connections !== null && confValue < 2 * connections) {
    findings.push({
      surface: 'conf',
      detail: `worker_rlimit_nofile ${confValue} is below 2 * worker_connections ${connections} = ${2 * connections}`,
    });
  }

  return { values, connections, findings };
}

function main(): void {
  const json = process.argv.includes('--json');
  const argRoot = process.argv.slice(2).find((a) => !a.startsWith('-'));
  const root = argRoot ? resolve(argRoot) : ROOT;
  const verdict = check(root);

  if (json) {
    console.log(JSON.stringify({ ...verdict, root }, null, 2));
  } else {
    const seen = Object.entries(verdict.values)
      .map(([k, v]) => `${k}=${v ?? 'unread'}`)
      .join(' ');
    console.log(`nginx-fd-limit guard: ${seen} (connections=${verdict.connections ?? 'unread'})`);
    for (const f of verdict.findings) console.error(`  [${f.surface}] ${f.detail}`);
  }

  if (verdict.findings.length > 0) {
    console.error(
      `\n✖ #3276 the file-descriptor limit is not one fact, or the grant does not cover the config.` +
        `\n  Fix the surfaces above. Do not delete a surface to make this pass: the conf number is` +
        `\n  what nginx asks for, and only the unit drop-in / the compose ulimits decide whether it` +
        `\n  gets it.`,
    );
    process.exit(1);
  }
  if (!json) console.log('OK: one number across the conf, the systemd drop-in and the compose ulimits.');
}

if (process.argv[1]?.includes('check-nginx-fd-limit')) main();
