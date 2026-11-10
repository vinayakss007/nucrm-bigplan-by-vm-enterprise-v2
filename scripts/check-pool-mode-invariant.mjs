#!/usr/bin/env node
/**
 * guard:pool-mode — the RLS backstop has exactly one safe pooler mode, and every
 * declaration of it in this repository must say the same thing.   (#3404)
 *
 * WHY THIS EXISTS
 * ---------------
 * `lib/db/rls.ts` sets `app.current_tenant` with `set_config(..., is_local=false)`
 * — a **session-scoped** GUC (ADR-0003). A GUC only survives the statements of one
 * request if the server connection is not handed to another client between them.
 * That is what PgBouncer's `pool_mode` decides:
 *
 *   session      — one client owns one server connection; `server_reset_query` runs
 *                  when it is released, so the GUC cannot outlive the client. Safe.
 *   transaction  — a server connection is recycled after EVERY transaction, so the
 *                  next tenant inherits the previous one's `app.current_tenant`.
 *                  Worse, `server_reset_query` is documented as inert in this mode,
 *                  so nothing clears it at all.
 *
 * Migration 0100 recorded the failure this produces: *"UPDATE … rowCount = 0
 * (silent) … every job logged success while changing nothing."* A silent zero-row
 * write is not an outage, it is a lie — which is why the mode is an invariant and
 * not a preference.
 *
 * WHAT WAS MEASURED BEFORE THIS GUARD EXISTED
 * -------------------------------------------
 * Five places described the mode, none asserted it, and they did not agree:
 *
 *   docker-compose.yml                    POOL_MODE=transaction   (+ DISCARD ALL)
 *   deploy/docker-compose.preprod.yml     POOL_MODE=session       (+ DISCARD ALL)
 *   deploy/docker-compose.production.yml  POOL_MODE=transaction   (NO reset query)
 *   deploy/pgbouncer/pgbouncer.ini        pool_mode = transaction (mounted by nothing)
 *   lib/db/rls.ts (header)                "PgBouncer is configured in transaction mode"
 *   lib/db/request-connection.ts (header) "pooling APPLIES here too … POOL_MODE=session"
 *
 * So the only environment that ran the safe mode was the one nobody ships to, prod
 * declared the leak combination (transaction + no reset), two modules documented
 * opposite configurations, and the ini that looks like the config of record is not
 * loaded by any compose file — it even carries `listen_addr = 0.0.0.0`, the exact
 * exposure #1042 removed from the live path. Nothing was wrong only *by the
 * accident* that prod never sets `PGBOUNCER_ENABLED=true`.
 *
 * THE CHECKS
 * ----------
 *   R1 mode        — a declared pgbouncer service must set POOL_MODE=session, and
 *                    must not leave it unset (pgbouncer's own default is session,
 *                    but an invariant that holds by default is not declared).
 *   R2 reset       — session pooling requires SERVER_RESET_QUERY (DISCARD ALL), or
 *                    the GUC survives the release and leaks to the next client.
 *   R3 reset-always— SERVER_RESET_QUERY_ALWAYS must be absent: it runs the reset
 *                    after every *transaction* instead of at release, wiping the GUC
 *                    mid-session — the failure mode the preprod comment describes.
 *   R4 ini-agrees  — if deploy/pgbouncer/pgbouncer.ini exists, its `pool_mode` must
 *                    also be session. The file is not mounted (see R5); a dead file
 *                    that contradicts the live one is how this issue survived.
 *   R5 wired-honest— a pooler no service in that file uses (nothing sets
 *                    PGBOUNCER_ENABLED=true) must be annotated in
 *                    scripts/pool-mode-annotations.json with a reason and the issue
 *                    that knows about it. Unused is allowed; unused *and silently
 *                    wrong* is not.
 *   R0 parseable   — a compose file that EXISTS but cannot be parsed is a finding,
 *                    not a skip. A guard that quietly ignores the file it cannot read
 *                    is how a wrong declaration stays green forever.
 *   advisory       — session mode holds one server connection per client, so
 *                    MAX_DB_CONNECTIONS is the real concurrency ceiling. Printed,
 *                    never failed: capacity is an owner decision, correctness is not.
 *
 * Exit codes: 0 clean · 1 finding · 2 not applicable (no compose file could be read).
 * `--allow-empty` downgrades 2 to a recorded skip; it never silences a 1.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOW_EMPTY = process.argv.includes('--allow-empty') || process.env.POOL_MODE_ALLOW_EMPTY === '1';
const REQUIRED_MODE = 'session';
const ANNOTATIONS_PATH = 'scripts/pool-mode-annotations.json';
const COMPOSE_FILES = [
  'docker-compose.yml',
  'deploy/docker-compose.yml',
  'deploy/docker-compose.preprod.yml',
  'deploy/docker-compose.production.yml',
];
const INI_PATH = 'deploy/pgbouncer/pgbouncer.ini';

/** compose `environment:` arrives as either a list of KEY=value or a mapping. */
function envOf(service) {
  const e = service?.environment;
  if (Array.isArray(e)) {
    const out = {};
    for (const item of e) {
      if (typeof item !== 'string') continue;
      const i = item.indexOf('=');
      if (i < 0) out[item] = '';
      else out[item.slice(0, i)] = item.slice(i + 1);
    }
    return out;
  }
  if (e && typeof e === 'object') return Object.fromEntries(Object.entries(e).map(([k, v]) => [k, String(v)]));
  return {};
}

/** Parse one compose file's `services:` map. Returns null when the file is absent. */
function readCompose(path, root = ROOT) {
  const abs = resolve(root, path);
  if (!existsSync(abs)) return null;
  // `!override` is a compose-tag this repo uses; the YAML library warns and keeps the
  // value, which is exactly what we want — a warning is not a parse failure. A real
  // syntax error is, and `main` turns it into a finding rather than skipping the file:
  // a guard that reads only the files it likes is how a broken declaration goes unseen.
  return YAML.parse(readFileSync(abs, 'utf8'), { prettyErrors: false, logLevel: 'error' })?.services ?? null;
}

/** Which files declare a pooler, and which of them actually route through one. */
export function analyse(servicesByFile, iniText, annotations, unparsable = []) {
  const findings = [];
  for (const [file, error] of unparsable) {
    findings.push({ rule: 'R0 compose parseable', where: file, detail: `present but unparsable (${error}) — the declaration could not be read, which is not the same as being correct` });
  }
  const advisories = [];
  let poolerCount = 0;

  for (const [file, services] of Object.entries(servicesByFile)) {
    if (!services) continue;
    const names = Object.keys(services);
    const poolerNames = names.filter((n) => /pgbouncer|pooler/.test(n));
    if (poolerNames.length === 0) continue;

    // A service in this file that would be routed through the pooler.
    const consumers = names.filter((n) => {
      if (poolerNames.includes(n)) return false;
      const env = envOf(services[n]);
      const url = env.DATABASE_URL ?? '';
      return env.PGBOUNCER_ENABLED === 'true' || /:6432/.test(url);
    });

    for (const pooler of poolerNames) {
      poolerCount += 1;
      const env = envOf(services[pooler]);
      const label = `${file} · services.${pooler}`;

      const mode = env.POOL_MODE;
      if (mode === undefined || mode === '') {
        findings.push({ rule: 'R1 pool_mode declared', where: label, detail: 'POOL_MODE is unset — pgbouncer defaults to session, but an invariant that holds by default is not declared' });
      } else if (mode !== REQUIRED_MODE) {
        findings.push({ rule: 'R1 pool_mode declared', where: label, detail: `POOL_MODE=${mode} — session-scoped app.current_tenant (ADR-0003) is recycled to the next client under transaction pooling; migration 0100 recorded the silent zero-row result` });
      }

      const reset = env.SERVER_RESET_QUERY;
      const resetAlways = env.SERVER_RESET_QUERY_ALWAYS;
      if (mode === 'transaction' && (reset === undefined || reset === '')) {
        findings.push({ rule: 'R2 reset query', where: label, detail: 'POOL_MODE=transaction and no SERVER_RESET_QUERY at all — the manual makes the reset inert under transaction pooling anyway, so this is the leak combination with nothing even pretending to clear the GUC' });
      } else if (mode !== 'transaction' && (reset === undefined || reset === '')) {
        findings.push({ rule: 'R2 reset query', where: label, detail: 'no SERVER_RESET_QUERY — on release the GUC survives on the server connection' });
      }
      if (resetAlways !== undefined && resetAlways !== '') {
        findings.push({ rule: 'R3 reset-always absent', where: label, detail: `SERVER_RESET_QUERY_ALWAYS=${resetAlways} — runs the reset after every transaction, wiping app.current_tenant mid-session` });
      }

      if (consumers.length === 0) {
        const a = annotations?.[file];
        if (!a?.reason || !a?.issue) {
          findings.push({ rule: 'R5 wired honestly', where: label, detail: `no service in ${file} sets PGBOUNCER_ENABLED=true or points DATABASE_URL at :6432, and ${ANNOTATIONS_PATH} carries no {reason, issue} for it — a pooler that is declared but not used must say so, or the next reader assumes it is load-bearing` });
        } else {
          advisories.push(`${label}: unused pooler, annotated by ${a.issue} — ${a.reason}`);
        }
      }

      const maxClient = Number(env.MAX_CLIENT_CONN);
      const maxDb = Number(env.MAX_DB_CONNECTIONS);
      if (Number.isFinite(maxClient) && Number.isFinite(maxDb) && maxClient > maxDb) {
        advisories.push(`${label}: session pooling holds one server connection per client, so MAX_DB_CONNECTIONS=${maxDb} is the real concurrency ceiling even though MAX_CLIENT_CONN=${maxClient} (postgres max_connections in deploy/postgres/postgresql.conf is the hard stop)`);
      }
    }
  }

  if (iniText !== null) {
    const m = iniText.match(/^\s*pool_mode\s*=\s*(\S+)/m);
    if (!m) {
      findings.push({ rule: 'R4 ini agrees', where: INI_PATH, detail: 'no pool_mode line — a pgbouncer ini without a declared mode is not a reference config' });
    } else if (m[1] !== REQUIRED_MODE) {
      findings.push({ rule: 'R4 ini agrees', where: INI_PATH, detail: `pool_mode = ${m[1]} contradicts the ${REQUIRED_MODE} the app requires; this file is not mounted by any compose service, which is how a dead path kept stating the wrong thing` });
    }
    if (/^\s*listen_addr\s*=\s*0\.0\.0\.0\s*$/m.test(iniText)) {
      advisories.push(`${INI_PATH}: listen_addr = 0.0.0.0 — if this file is ever mounted, the pooler binds every interface (#1042 removed that from the live path)`);
    }
  }

  return { findings, advisories, poolerCount };
}

export function main({ root = ROOT } = {}) {
  const servicesByFile = {};
  const unparsable = [];
  let seen = 0;
  for (const f of COMPOSE_FILES) {
    try {
      const services = readCompose(f, root);
      if (services === null) continue;
      seen += 1;
      servicesByFile[f] = services;
    } catch (e) {
      seen += 1;
      unparsable.push([f, String(e.message).split('\n')[0]]);
    }
  }
  if (seen === 0) {
    return ALLOW_EMPTY
      ? { code: 0, findings: [], advisories: [], poolerCount: 0, note: 'no compose file to read (allowed empty)' }
      : { code: 2, findings: [], advisories: [], poolerCount: 0, note: 'no compose file to read' };
  }

  const iniAbs = resolve(root, INI_PATH);
  const iniText = existsSync(iniAbs) ? readFileSync(iniAbs, 'utf8') : null;

  let annotations = {};
  const annAbs = resolve(root, ANNOTATIONS_PATH);
  if (existsSync(annAbs)) {
    try { annotations = JSON.parse(readFileSync(annAbs, 'utf8')); }
    catch (e) { return { code: 1, findings: [{ rule: 'annotations', where: ANNOTATIONS_PATH, detail: `unparsable: ${e.message}` }], advisories: [], poolerCount: 0, note: `${ANNOTATIONS_PATH} is not valid JSON` }; }
  }

  const out = analyse(servicesByFile, iniText, annotations, unparsable);
  return {
    code: out.findings.length > 0 ? 1 : 0,
    findings: out.findings,
    advisories: out.advisories,
    poolerCount: out.poolerCount,
    note: `${Object.keys(servicesByFile).length} compose file(s) parsed, ${out.poolerCount} pooler service(s)`,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  // `--root <dir>` exists so a test can point the screen at a planted tree; the
  // default is this module's own repository, not the cwd, so `npm run` from a
  // subdirectory still guards the right files.
  const rootFlag = process.argv.indexOf('--root');
  const r = main(rootFlag > -1 && process.argv[rootFlag + 1] ? { root: resolve(process.argv[rootFlag + 1]) } : {});
  for (const a of r.advisories) console.log(`  · advisory — ${a}`);
  if (r.code === 2) {
    console.log(`[guard:pool-mode] NOT APPLICABLE — ${r.note}${ALLOW_EMPTY ? '' : ' (pass --allow-empty on a container-less runner)'}`);
  } else if (r.code === 1) {
    console.error(`[guard:pool-mode] ${r.findings.length} finding(s) — ${r.note}`);
    for (const f of r.findings) console.error(`  ✗ ${f.rule} @ ${f.where}\n      ${f.detail}`);
    console.error('  Fix: declare POOL_MODE=session + SERVER_RESET_QUERY="DISCARD ALL", or annotate an unused pooler in ' + ANNOTATIONS_PATH + '.');
  } else {
    console.log(`[guard:pool-mode] ✅ ${r.note}; every declared pooler is in ${REQUIRED_MODE} mode with its reset query.`);
  }
  process.exit(r.code);
}
