/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Postgres authentication guard (#3265).
 *
 * `initdb` writes a `pg_hba.conf` into the data directory, and the official image
 * writes `trust` for local and loopback-TCP connections unless the entrypoint is
 * told otherwise. Nothing in this repo told it otherwise, so every new `pgdata`
 * volume came up with "no credential asked for" — including a volume created after
 * the hardened file was installed, because the hardened file *lives inside the
 * volume it replaces*. Authentication was a property of the data directory instead
 * of a property of the deployment.
 *
 * This screen reads the two places the deployment states its policy:
 *
 *   1. `deploy/postgres/pg_hba.conf` — no rule weaker than `scram-sha-256`, and
 *      `peer`/`scram` for the socket. `trust`, `md5` and cleartext `password` are
 *      violations; so is a file whose rules parse to nothing, because a screen whose
 *      pattern matches nothing also reports "all clear".
 *   2. every compose service that runs a Postgres image — both `--auth-local` and
 *      `--auth-host` must be pinned through `POSTGRES_INITDB_ARGS`, and
 *      `POSTGRES_HOST_AUTH_METHOD` must not name a weak method. A service that
 *      forgets the pin is invisible in review: `npm install`, `docker compose up`
 *      and `pg_isready` all stay green while the socket is open.
 *
 * The running server is asserted separately, on the host, by
 * `deploy/scripts/health-check.sh`, which asks for a credential and checks whether
 * the answer changes. This guard never connects and never reads a credential.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Methods that do not require a secret, or require one Postgres can crack offline. */
export const WEAK_METHODS = new Set(['trust', 'password', 'md5', 'ident', 'pam', 'ldap', 'radius']);
/** Methods this repo accepts as a declared policy. */
export const ACCEPTED_METHODS = new Set(['scram-sha-256', 'peer', 'cert']);

const indent = (line) => line.match(/^ */)[0].length;

/**
 * Parse `pg_hba.conf` text. Fields are whitespace-separated; a rule is
 * `type database user address method` (4 fields for `local`) and anything else is
 * recorded as an error rather than guessed at — a miscount here is the difference
 * between "this line requires a password" and "this line requires nothing".
 */
export function parsePgHba(text) {
  const rules = [];
  const errors = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (raw === '' || raw.startsWith('#')) continue;
    const fields = raw.split(/\s+/);
    if (fields[0] === 'local') {
      if (fields.length !== 4) {
        errors.push({ line: i + 1, text: raw, why: 'a `local` rule needs type, database, user, method' });
        continue;
      }
      rules.push({ type: 'local', database: fields[1], user: fields[2], address: null, method: fields[3], line: i + 1 });
      continue;
    }
    if (!['host', 'hostssl', 'hostnossl', 'hostgssenc', 'hostnogssenc'].includes(fields[0])) {
      errors.push({ line: i + 1, text: raw, why: `unknown rule type \`${fields[0]}\`` });
      continue;
    }
    if (fields.length !== 5) {
      errors.push({ line: i + 1, text: raw, why: 'a host rule needs type, database, user, address, method' });
      continue;
    }
    rules.push({
      type: fields[0],
      database: fields[1],
      user: fields[2],
      address: fields[3],
      method: fields[4],
      line: i + 1,
    });
  }
  return { rules, errors };
}

/** @returns {string[]} one sentence per way this HBA text is weaker than the policy */
export function checkPgHbaRules(rules, errors) {
  const problems = errors.map((e) => `line ${e.line}: ${e.why} — ${e.text}`);
  if (rules.length === 0 && problems.length === 0) {
    problems.push('no rule parsed — a screen that matches nothing reports "all clear", so this fails');
  }
  for (const r of rules) {
    if (WEAK_METHODS.has(r.method)) {
      problems.push(`line ${r.line}: ${r.type} ${r.database} ${r.user}${r.address ? ' ' + r.address : ''} uses \`${r.method}\``);
    } else if (!ACCEPTED_METHODS.has(r.method)) {
      problems.push(`line ${r.line}: \`${r.method}\` is not a method this repo declares as policy`);
    }
    if (r.type === 'local' && r.method === 'cert') {
      problems.push(`line ${r.line}: \`cert\` is not a socket authentication method`);
    }
  }
  if (!rules.some((r) => r.method === 'scram-sha-256')) {
    problems.push('no rule requires scram-sha-256, so nothing in this file asks for a credential');
  }
  return problems;
}

/** All compose files at the repo root and under `deploy/`, the way the other compose screens read them. */
export function findComposeFiles(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.git' || entry === '.next') continue;
      const p = join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/^docker-compose[^/]*\.(ya?ml)$/.test(entry)) out.push(relative(root, p).split('\\').join('/'));
    }
  };
  if (statSync(root, { throwIfNoEntry: false })?.isDirectory()) walk(root);
  return out.sort();
}

const strip = (value) => value.replace(/^['"]|['"]$/g, '').trim();
/** A Postgres *server* image, not an exporter or a pooler wearing the same word. */
export function isPostgresImage(image) {
  return /(^|\/)postgres(:|$)/.test(strip(image || ''));
}

/**
 * Read every service's `image` and `environment`, in both the `- KEY=VALUE` and the
 * `KEY: VALUE` forms compose accepts. Indent-tracked rather than regex-matched: a
 * `ports:` or `volumes:` entry containing `=` is not an environment variable, and a
 * nested `deploy:` block must not be read as the service's own keys.
 */
export function readComposeServices(content) {
  const services = [];
  let cur = null;
  let block = null;
  for (const raw of content.split('\n')) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    const ind = indent(raw);
    const body = raw.trim();

    if (ind === 0) {
      cur = null; // `services:`, `volumes:`, `networks:` — a new top-level key ends any service
      block = null;
      continue;
    }
    if (ind === 2) {
      if (body.endsWith(':')) {
        cur = { name: body.slice(0, -1), image: null, env: {} };
        services.push(cur);
      } else {
        cur = null;
      }
      block = null;
      continue;
    }
    if (!cur) continue;

    if (ind === 4) {
      const colon = body.indexOf(':');
      const key = colon === -1 ? body : body.slice(0, colon);
      const value = colon === -1 ? '' : body.slice(colon + 1).trim();
      if (key === 'image') cur.image = strip(value);
      block = key === 'environment' && value === '' ? 'environment' : null;
      continue;
    }
    if (ind >= 6 && block === 'environment') {
      if (body.startsWith('-')) {
        const pair = body.slice(1).trim();
        const eq = pair.indexOf('=');
        if (eq > 0) cur.env[strip(pair.slice(0, eq))] = strip(pair.slice(eq + 1));
        else if (eq === -1 && pair) cur.env[strip(pair)] = '';
      } else {
        const colon = body.indexOf(':');
        if (colon > 0) cur.env[strip(body.slice(0, colon))] = strip(body.slice(colon + 1));
      }
    }
  }
  return services.filter((s) => isPostgresImage(s.image));
}

/**
 * @returns {{file: string, service: string, problems: string[]}[]} one entry per
 *   Postgres service whose auth method is not pinned for a fresh data directory.
 */
export function checkComposeAuthPins(file, postgresServices) {
  const out = [];
  for (const svc of postgresServices) {
    const problems = [];
    const initdb = svc.env['POSTGRES_INITDB_ARGS'];
    const hostMethod = svc.env['POSTGRES_HOST_AUTH_METHOD'];
    for (const [flag, label] of [
      ['--auth-local', 'the unix socket'],
      ['--auth-host', 'TCP'],
    ]) {
      const match = initdb ? new RegExp(`${flag}=(\\S+)`).exec(initdb) : null;
      if (!match) {
        problems.push(`${flag} is not set, so a new volume takes the image default for ${label}`);
      } else if (WEAK_METHODS.has(match[1]) || !ACCEPTED_METHODS.has(match[1])) {
        problems.push(`${flag}=${match[1]} is weaker than the declared policy for ${label}`);
      }
    }
    if (hostMethod === undefined) {
      problems.push('POSTGRES_HOST_AUTH_METHOD is unset, so the image chooses the host method');
    } else if (WEAK_METHODS.has(hostMethod) || hostMethod === '') {
      problems.push(`POSTGRES_HOST_AUTH_METHOD=${hostMethod || '(empty)'} is weaker than the declared policy`);
    }
    if (problems.length) out.push({ file, service: svc.name, problems });
  }
  return out;
}

export function runGuard({ root = ROOT, quiet = false } = {}) {
  const hbaPath = join(root, 'deploy', 'postgres', 'pg_hba.conf');
  const problems = [];
  if (!existsSync(hbaPath)) {
    problems.push('deploy/postgres/pg_hba.conf is missing — the policy would exist only inside data directories');
    if (!quiet) {
      console.error('pg-hba guard: FAIL\n  ' + problems.join('\n  '));
    }
    return { ok: false, hbaRules: 0, composeFiles: [], unpinned: [], problems };
  }

  const parsed = parsePgHba(readFileSync(hbaPath, 'utf8'));
  problems.push(...checkPgHbaRules(parsed.rules, parsed.errors));

  const composeFiles = findComposeFiles(root);
  const postgresServices = [];
  const unpinned = [];
  for (const file of composeFiles) {
    const services = readComposeServices(readFileSync(join(root, file), 'utf8'));
    postgresServices.push(...services.map((s) => `${file} :: ${s.name}`));
    unpinned.push(...checkComposeAuthPins(file, services));
  }

  if (!quiet) {
    console.log(
      `pg-hba guard: ${composeFiles.length} compose file(s), ${postgresServices.length} Postgres service(s), ` +
        `${parsed.rules.length} declared rule(s).`,
    );
    for (const p of problems) console.log(`  [policy] ${p}`);
    for (const u of unpinned) {
      for (const p of u.problems) console.log(`  [UNPINNED] ${u.file} :: ${u.service} — ${p}`);
    }
    const failed = problems.length + unpinned.length;
    if (failed === 0) {
      console.log('OK: the shipped HBA requires a credential, and every Postgres service pins one for a new volume.');
    } else {
      console.error(
        `\nFAIL: ${failed} problem(s).\n` +
          'A new Postgres volume is initialized from the image default — `trust`, no credential asked for —\n' +
          'unless the service pins --auth-local/--auth-host itself, and the hardened pg_hba.conf an operator\n' +
          'installed lives inside the data directory the new volume replaces. Pin it in the service:\n' +
          '  - POSTGRES_HOST_AUTH_METHOD=scram-sha-256\n' +
          '  - POSTGRES_INITDB_ARGS=--auth-local=scram-sha-256 --auth-host=scram-sha-256\n' +
          'and see deploy/postgres/pg_hba.conf for what each topology declares.\n' +
          'The running server is asserted on the host by deploy/scripts/health-check.sh, not here.',
      );
    }
  }

  return {
    ok: problems.length === 0 && unpinned.length === 0,
    hbaRules: parsed.rules.length,
    composeFiles,
    unpinned,
    problems,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(runGuard().ok ? 0 : 1);
}
