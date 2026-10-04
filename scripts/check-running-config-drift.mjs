#!/usr/bin/env node
/**
 * Deploy-integrity guard: does the RUNNING container hold the repo's config?
 *
 * WHY A SINGLE-FILE BIND MOUNT CAN GO INVISIBLE
 * ---------------------------------------------
 * A bind mount of a *file* pins an inode, not a path. `git checkout`,
 * `git cherry-pick`, `npm version` and most editors replace the file rather
 * than writing into it, which swaps the inode — so every container started
 * before that keeps serving bytes that no longer exist at that path. Nothing
 * reports it: `docker compose ps` is happy, `nginx -s reload` re-reads the same
 * stale inode, and even restarting the process does not re-attach the mount.
 * Only recreating the container does.
 *
 * This is not hypothetical: the #2116 X-Forwarded-For fix and the monitoring
 * pipeline fix were both committed, while the running nginx, promtail and
 * prometheus were still on pre-fix bytes. The live consequence measured on
 * 2026-10-03: a forged `X-Forwarded-For` passed the edge and landed verbatim in
 * login_attempts.ip_address, because the deployed nginx still used
 * $proxy_add_x_forwarded_for instead of the committed $remote_addr.
 *
 * Bytes are compared, not inodes: an identical rewrite is harmless, and two
 * unrelated files can share a name.
 *
 * The same blind spot exists for a value compose bakes into the container at
 * create time rather than mounting, so `stop_grace_period` is compared against
 * the running `HostConfig.StopTimeout` too — since PP-029 that number is the
 * bound on how long a redeploy waits for live work.
 *
 * A third thing nothing checked (PP-016): what the running container *is*. The only artifact
 * identifier the image carries is `.next/BUILD_ID`, and when `--build-arg SENTRY_RELEASE` was not
 * passed the Dockerfile writes `build-$(date -u +%s)` into it. That string is simultaneously the
 * Sentry release, so an untagged deploy means events bucket per build and no post-mortem can say
 * which commit was serving traffic. Reported per container as `release identity` below.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const MAX_BYTES = 2 * 1024 * 1024;

function sh(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
}

function containers() {
  // Only live service instances of this deployment. A `docker compose run`
  // one-off carries project+service labels but no container-number, and it is
  // NOT what traffic hits — including one would both add noise and put the
  // wrong service in the recreation command below.
  const project = process.env.COMPOSE_PROJECT || 'deploy';
  // Presence-only label filter: `--filter label=<key>` matches any container
  // that carries the key at all, which is exactly how one-offs are excluded.
  const list = (extra) => execFileSync('docker', ['ps', '--filter',
    `label=com.docker.compose.project=${project}`, ...extra, '--format', '{{.Names}}'],
  { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean);
  const all = list([]);
  const live = list(['--filter', 'label=com.docker.compose.container-number']);
  const oneoff = all.length - live.length;
  if (oneoff > 0) console.log(`(ignoring ${oneoff} one-off compose-run container${oneoff > 1 ? 's' : ''} — not a live service instance)`);
  return live;
}

/** Bind mounts whose SOURCE is a regular file — directory mounts cannot drift. */
function fileMounts(name) {
  const out = execFileSync('docker', ['inspect', '-f',
    '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}\t{{.Destination}}{{println}}{{end}}{{end}}', name],
  { encoding: 'utf8' });
  const rows = [];
  for (const line of out.split('\n')) {
    const [src, dst] = line.split('\t');
    if (!src || !dst) continue;
    let stat;
    try { stat = statSync(src); } catch { continue; }
    if (!stat.isFile()) continue;
    if (stat.size > MAX_BYTES) { rows.push({ src, dst, skipped: `source is ${stat.size} bytes` }); continue; }
    rows.push({ src, dst });
  }
  return rows;
}

function remoteDigest(name, dst) {
  try {
    // `cat` on purpose: minimal images ship without md5sum/sha256sum, and the
    // hashing stays on this side so the comparison is the same algorithm.
    const bytes = execFileSync('docker', ['exec', name, 'cat', dst], { maxBuffer: MAX_BYTES + 1024 });
    return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

/**
 * The other half of "is the running container the committed one": bind-mounted
 * file *contents* are compared above, but a service-level knob that compose
 * bakes into the container at create time is invisible to that check. Since
 * PP-029 the `app` service's `stop_grace_period` is load-bearing — it is the
 * real bound on how long a redeploy waits for live work — and a value edited in
 * the file without a recreate, or tuned with `docker update` by hand, silently
 * stops matching what a stop actually honours.
 */
const DEFAULT_STOP_TIMEOUT_S = 10; // Docker's own default when nothing is declared

function parseComposeDuration(text) {
  const units = [...String(text).matchAll(/(\d+)\s*([hms])/g)];
  if (!units.length || units.map((u) => u[0]).join('') !== String(text)) return null;
  const scale = { h: 3600, m: 60, s: 1 };
  return units.reduce((total, [, n, u]) => total + Number(n) * scale[u], 0);
}

/** `com.docker.compose.project.config_files` is the exact `-f` list the running project used. */
function configFilesOf(name) {
  const out = execFileSync('docker', ['inspect', '-f',
    '{{ index .Config.Labels "com.docker.compose.project.config_files" }}', name],
  { encoding: 'utf8' }).trim();
  return out ? out.split(',') : [];
}

const composeCache = new Map();
/** Declared `stop_grace_period` per service, from the resolved (merged) compose config. */
function declaredGrace(files) {
  if (!composeCache.has(files.join(','))) {
    let parsed = null;
    try {
      const args = ['compose'];
      for (const f of files) args.push('-f', f);
      args.push('config', '--format', 'json');
      parsed = JSON.parse(execFileSync('docker', args, { encoding: 'utf8', maxBuffer: MAX_BYTES })).services || {};
    } catch {
      parsed = null; // no docker/compose in this environment, or the files are gone
    }
    composeCache.set(files.join(','), parsed);
  }
  return composeCache.get(files.join(','));
}

/** Docker stores this on `.Config`, not `.HostConfig`; unset prints as `<nil>` and means 10 s. */
function runningStopTimeout(name) {
  const raw = execFileSync('docker', ['inspect', '-f', '{{.Config.StopTimeout}}', name],
    { encoding: 'utf8' }).trim();
  // An explicit `0` (kill immediately) is a real value and must not collapse into
  // the default, so only the template's own empty render counts as unset.
  return raw === '<nil>' || raw === '<no value>' || raw === '' ? DEFAULT_STOP_TIMEOUT_S : Number(raw);
}

function stopGraceCheck(name) {
  const service = execFileSync('docker', ['inspect', '-f',
    '{{ index .Config.Labels "com.docker.compose.service" }}', name],
  { encoding: 'utf8' }).trim();
  const files = configFilesOf(name);
  const key = files.join(',');
  const declared = files.length ? declaredGrace(files) : null;
  if (!declared || !declared[service]) {
    return { skipKey: key || name, skip: `stop_grace_period unchecked for ${key || '(container without a config_files label)'} — resolved compose config is not readable here` };
  }
  const raw = declared[service].stop_grace_period;
  const want = raw === undefined ? DEFAULT_STOP_TIMEOUT_S : parseComposeDuration(raw);
  if (want === null) return { skipKey: key, skip: `${name} — unparsable stop_grace_period "${raw}"` };
  return { name, service, want, got: runningStopTimeout(name), declared: raw === undefined ? `(default ${DEFAULT_STOP_TIMEOUT_S}s)` : String(raw) };
}

/**
 * PP-016 — whether a running container can be tied to a commit at all.
 * `resolveRelease()` in sentry.server.config.ts falls back to `.next/BUILD_ID`, and the
 * Dockerfile writes `build-$(date -u +%s)` into that file when `--build-arg SENTRY_RELEASE`
 * was not passed. A release that is a build timestamp means Sentry (and any later post-mortem)
 * buckets events per build rather than per deploy — and it is the only artifact identifier we
 * have, because no commit sha is recorded in the image. So this prints the shape, loudly.
 */
const BUILD_ID_PATH = '/app/.next/BUILD_ID';
const EPOCH_FALLBACK = /^build-\d+$/;

function envValue(name, key) {
  const raw = execFileSync('docker', ['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', name],
    { encoding: 'utf8' });
  const line = raw.split('\n').find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1) : '';
}

function releaseIdentity(name) {
  let buildId = '';
  try {
    buildId = execFileSync('docker', ['exec', name, 'cat', BUILD_ID_PATH], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null; // not a Next.js app container — nothing to say
  }
  const runtime = envValue(name, 'SENTRY_RELEASE');
  const baked = envValue(name, 'NEXT_PUBLIC_SENTRY_RELEASE');
  const effective = runtime || baked || buildId;
  return { name, buildId, runtime, effective, untagged: EPOCH_FALLBACK.test(effective) };
}

const drift = [];
const graceDrift = [];
const untaggedRelease = [];
const taggedRelease = [];
const ok = [];
const unchecked = [];
let graceOk = 0;
const skippedGrace = new Set();

for (const name of containers()) {
  for (const m of fileMounts(name)) {
    if (m.skipped) { unchecked.push(`${name}  ${m.src} — ${m.skipped}`); continue; }
    const host = sh(resolve(m.src));
    const ctr = remoteDigest(name, m.dst);
    if (ctr === null) { unchecked.push(`${name}  ${m.src} — container cannot read ${m.dst}`); continue; }
    if (host === ctr) ok.push(`${name}  ${m.dst}`);
    else drift.push({ name, src: m.src, dst: m.dst, host, ctr });
  }
  try {
    const g = stopGraceCheck(name);
    if (g.skip) {
      // One line per compose file-set, not per container: 17 services sharing an
      // unreadable config would otherwise bury the bind-mount results above.
      if (!skippedGrace.has(g.skipKey)) { skippedGrace.add(g.skipKey); unchecked.push(g.skip); }
    } else if (g.want === g.got) graceOk++;
    else graceDrift.push(g);
  } catch (err) {
    unchecked.push(`${name} — stop_grace_period check failed: ${err instanceof Error ? err.message : err}`);
  }
  try {
    const rel = releaseIdentity(name);
    if (rel) (rel.untagged ? untaggedRelease : taggedRelease).push(rel);
  } catch (err) {
    unchecked.push(`${name} — release identity check failed: ${err instanceof Error ? err.message : err}`);
  }
}

console.log(`running-config drift: ${ok.length} identical · ${drift.length} drifted · ${unchecked.length} unchecked`);
console.log(`stop_grace_period: ${graceOk} match the running container · ${graceDrift.length} drifted`);
// One line per container, not one aggregate: several services can run the same image and
// each is a separate deploy, so "3 untagged" tells nobody which one to look at.
console.log(`release identity: ${taggedRelease.length} tied to a commit · ${untaggedRelease.length} untagged (build-timestamp fallback)`);
for (const r of taggedRelease) console.log(`  ok        ${r.name}  release=${r.effective}`);
for (const r of untaggedRelease) {
  console.log(`  UNTAGGED  ${r.name}  BUILD_ID=${r.buildId} · SENTRY_RELEASE=${r.runtime || '(empty)'} — this artifact cannot be tied to a commit`);
}
for (const d of drift) {
  console.log(`  DRIFT  ${d.name}  ${d.src}\n         repo=${d.host} running=${d.ctr} — the container is NOT serving the committed file`);
}
for (const g of graceDrift) {
  console.log(`  DRIFT  ${g.name} ${g.service}  stop_grace_period: compose=${g.declared} (${g.want}s) running=${g.got}s`);
}
for (const u of unchecked) console.log(`  ?      ${u}`);

let failed = false;

if (drift.length > 0 || graceDrift.length > 0) {
  // Compose takes SERVICE names, not container names, so the command printed
  // here is copy-pasteable.
  const serviceOf = (name) => execFileSync('docker', ['inspect', '-f',
    '{{ index .Config.Labels "com.docker.compose.service" }}', name],
  { encoding: 'utf8' }).trim() || name;
  const services = [...new Set([...drift.map((d) => d.name), ...graceDrift.map((g) => g.name)].map(serviceOf))];
  console.log('\n  A reload cannot fix this — a file bind mount pins an inode and HostConfig is fixed at create time,');
  console.log('  so only recreation re-attaches the mount or re-applies the declared stop grace:');
  console.log(`    cd deploy && docker compose -f docker-compose.production.yml -f docker-compose.preprod.yml up -d --force-recreate ${services.join(' ')}`);
  failed = true;
}

if (untaggedRelease.length > 0) {
  console.log('\n  Nothing in the running image records a commit, so Sentry groups events by build id and a');
  console.log('  post-mortem cannot say what is deployed. Both compose paths interpolate the same variable');
  console.log('  (`build.args.SENTRY_RELEASE` and `environment`), so set it once for the build AND the run:');
  console.log('    cd deploy && SENTRY_RELEASE=$(git -C .. rev-parse --short HEAD) \\');
  console.log('      docker compose -f docker-compose.production.yml -f docker-compose.preprod.yml build app');
  console.log('    cd deploy && SENTRY_RELEASE=$(git -C .. rev-parse --short HEAD) \\');
  console.log('      docker compose -f docker-compose.production.yml -f docker-compose.preprod.yml up -d app');
  console.log('  Do NOT put a fixed SENTRY_RELEASE in deploy/.env: it interpolates forever, so a stale value');
  console.log('  becomes a confidently-wrong release — worse than the empty one this check is complaining about.');
  failed = true;
}

if (failed) process.exit(1);
