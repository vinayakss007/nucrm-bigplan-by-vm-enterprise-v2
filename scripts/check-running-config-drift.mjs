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
 *
 * #2332 — EMPTY IS NOT CLEAN. All three checks above iterate live containers, so a host
 * where the app runs outside compose labels — or is not running at all — inspected nothing
 * and still printed `0 identical · 0 drifted · 0 unchecked` with exit 0, converting "we have
 * no idea what is running" into "config matches the repo". The exit-code contract is now:
 *   0 — something was actually inspected and it matches the repo
 *   1 — drift: bind-mount bytes, stop_grace_period, a declared service with no live
 *       container, or an untagged release
 *   2 — NOT APPLICABLE: nothing could be inspected (no compose-labelled containers for
 *       the project, docker unreachable, or the resolved compose config unreadable)
 * `--allow-empty` / `RUNNING_CONFIG_ALLOW_EMPTY=1` downgrades 2 to a printed, recorded
 * skip for container-less runners (pm2 production VMs, CI boxes). It never silences a 1.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const MAX_BYTES = 2 * 1024 * 1024;

// #2332: the documented opt-out for runners/hosts where no compose-labelled
// container can exist. It may turn exit 2 (NOT APPLICABLE) into a printed,
// recorded skip — it must never silence a real finding (exit 1).
const ALLOW_EMPTY = process.argv.includes('--allow-empty') || process.env.RUNNING_CONFIG_ALLOW_EMPTY === '1';
const PROJECT = process.env.COMPOSE_PROJECT || 'deploy';

function sh(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
}

function containers() {
  // Only live service instances of this deployment. A `docker compose run`
  // one-off carries project+service labels but no container-number, and it is
  // NOT what traffic hits — including one would both add noise and put the
  // wrong service in the recreation command below.
  // Presence-only label filter: `--filter label=<key>` matches any container
  // that carries the key at all, which is exactly how one-offs are excluded.
  const all = dockerPs();
  const live = dockerPs('--filter', 'label=com.docker.compose.container-number');
  const oneoff = all.length - live.length;
  if (oneoff > 0) console.log(`(ignoring ${oneoff} one-off compose-run container${oneoff > 1 ? 's' : ''} — not a live service instance)`);
  return live;
}

function dockerPs(...extra) {
  return execFileSync('docker', ['ps', ...extra, '--filter',
    `label=com.docker.compose.project=${PROJECT}`, '--format', '{{.Names}}'],
  { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean);
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

function serviceOf(name) {
  return execFileSync('docker', ['inspect', '-f',
    '{{ index .Config.Labels "com.docker.compose.service" }}', name],
  { encoding: 'utf8' }).trim();
}

function stopGraceCheck(name) {
  const service = serviceOf(name);
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
 * #2332 — with zero live containers there is no `project.config_files` label
 * to read, so the declared set falls back to the repo's own compose files (the
 * same pair the recreate hint uses). `COMPOSE_FILES` (comma) or `COMPOSE_FILE`
 * (colon, compose-native) lets a host point at its real stack.
 */
function defaultComposeFiles() {
  const fromEnv = `${process.env.COMPOSE_FILES || ''},${process.env.COMPOSE_FILE || ''}`
    .split(/[:,]/).map((s) => s.trim()).filter(Boolean);
  const candidates = fromEnv.length
    ? fromEnv
    : ['deploy/docker-compose.production.yml', 'deploy/docker-compose.preprod.yml'];
  return candidates.filter((f) => {
    try { return statSync(resolve(f)).isFile(); } catch { return false; }
  });
}

/**
 * #2332 — the other half of "is the running container the committed one": a
 * service the compose files DECLARE but no live container runs is exactly the
 * drift this check exists to notice, and today it is invisible — an absent
 * service just shrinks `live`, nothing is compared, and the run is green.
 */
function serviceCoverage(live) {
  const running = new Set();
  const fileSets = new Map();
  for (const name of live) {
    try {
      const service = serviceOf(name);
      if (service) running.add(service);
      const files = configFilesOf(name);
      if (files.length) fileSets.set(files.join(','), files);
    } catch { /* per-container failures are reported by their own checks */ }
  }
  // A service legitimately has no RUNNING container when it is a one-shot job —
  // `minio-init` creates the buckets and exits by design. Existence is therefore
  // judged against the containers compose CREATED (running or exited); a service
  // with no container at all is still exactly the missing case #2332 is about.
  const present = new Set(running);
  let presentTrustworthy = false;
  try {
    for (const name of dockerPs('-a', '--filter', 'label=com.docker.compose.container-number')) {
      const service = serviceOf(name);
      if (service) present.add(service);
    }
    presentTrustworthy = true;
  } catch { /* fall back to running-only */ }
  const missing = [];
  const unresolved = [];
  const declaredServices = new Set();
  for (const [key, files] of fileSets) {
    const declared = declaredGrace(files);
    if (!declared) { unresolved.push({ key, reason: 'resolved compose config unreadable here (no docker compose, or the files are gone)' }); continue; }
    if (!presentTrustworthy && running.size < Object.keys(declared).length) {
      // Without the `-a` census we cannot tell an exited one-shot from an
      // absent service; claiming "missing" would be a guess, so this half of
      // the check reports itself as uninspected instead (same honesty rule).
      unresolved.push({ key, reason: 'a declared service has no live container and the `docker ps -a` census failed — cannot tell an exited one-shot job from an absent service' });
      continue;
    }
    for (const service of Object.keys(declared)) {
      declaredServices.add(service);
      if (!present.has(service)) missing.push({ service, files });
    }
  }
  return { runningCount: running.size, declaredCount: declaredServices.size, missing, unresolved };
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

let live;
try {
  live = containers();
} catch (err) {
  // #2332: "docker is not here" and "docker found nothing" are the same honest
  // answer — nothing could be inspected. Falling through would print the old
  // all-zeros line, which reads as a clean bill of health.
  console.log(`NOT APPLICABLE — docker is not reachable on this host (${err instanceof Error ? err.message.split('\n')[0] : String(err)}) (0 inspected)`);
  if (ALLOW_EMPTY) { console.log('(skipped — --allow-empty / RUNNING_CONFIG_ALLOW_EMPTY=1; this line is the honest state, not a clean bill)'); process.exit(0); }
  console.log('  Run this on the host that serves the compose stack, or opt out deliberately for a container-less runner:');
  console.log('    RUNNING_CONFIG_ALLOW_EMPTY=1 npm run guard:running-config');
  process.exit(2);
}

if (live.length === 0) {
  // #2332 AC: "0 inspected" is not "0 findings". Say so, name the services the
  // repo's compose files declare ("declare app in compose, run nothing" must
  // fail naming the missing service), and exit a code CI cannot read as green.
  console.log(`NOT APPLICABLE — no compose-labelled containers for project '${PROJECT}' found (0 inspected)`);
  const files = defaultComposeFiles();
  const declared = files.length ? declaredGrace(files) : null;
  if (declared) {
    for (const service of Object.keys(declared)) console.log(`  MISSING  ${service} — declared in ${files.join(' + ')} but no live container`);
  }
  if (ALLOW_EMPTY) { console.log('(skipped — --allow-empty / RUNNING_CONFIG_ALLOW_EMPTY=1; the lines above are the honest state, not a clean bill)'); process.exit(0); }
  console.log('\n  A green run from here would claim "running config matches the repo" while nothing was');
  console.log('  compared: bind-mount bytes, stop_grace_period and release identity all need a live');
  console.log('  container. Run this on the host serving the stack, or opt out deliberately:');
  console.log('    RUNNING_CONFIG_ALLOW_EMPTY=1 npm run guard:running-config');
  process.exit(2);
}

for (const name of live) {
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

const coverage = serviceCoverage(live);

console.log(`running-config drift: ${ok.length} identical · ${drift.length} drifted · ${unchecked.length} unchecked`);
console.log(`stop_grace_period: ${graceOk} match the running container · ${graceDrift.length} drifted`);
// #2332: the summary must be able to express "what was inspected" — a count of
// live containers against the services the compose files declare.
console.log(`inspected: ${live.length} live container(s) covering ${coverage.runningCount} service(s) of ${coverage.declaredCount} declared`);
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
  const services = [...new Set([...drift.map((d) => d.name), ...graceDrift.map((g) => g.name)].map((n) => serviceOf(n) || n))];
  console.log('\n  A reload cannot fix this — a file bind mount pins an inode and HostConfig is fixed at create time,');
  console.log('  so only recreation re-attaches the mount or re-applies the declared stop grace:');
  console.log(`    cd deploy && docker compose -f docker-compose.production.yml -f docker-compose.preprod.yml up -d --force-recreate ${services.join(' ')}`);
  failed = true;
}

if (coverage.missing.length > 0) {
  // #2332: a declared service with no live container was never compared at
  // all — the far worse state than a stale one. Group by the file-set that
  // declares it so the printed `up -d` is the one for this project.
  console.log('\n  Services the project compose files DECLARE with no live container — nothing was compared for them:');
  const byFiles = new Map();
  for (const m of coverage.missing) {
    const key = m.files.join(',');
    if (!byFiles.has(key)) byFiles.set(key, []);
    byFiles.get(key).push(m.service);
  }
  for (const [key, services] of byFiles) {
    const fArgs = key.split(',').map((f) => `-f ${f}`).join(' ');
    console.log(`  MISSING  ${services.join(', ')}`);
    console.log(`    docker compose ${fArgs} up -d ${services.join(' ')}`);
  }
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

// #2332 AC 1, second half: same treatment as the empty case when part of the
// check could not run at all (`parsed = null` used to be swallowed). What
// could not be inspected is NOT silently green. A real finding above already
// exited 1; only an otherwise-clean run reaches here.
if (coverage.unresolved.length > 0) {
  console.log('NOT APPLICABLE — part of this check could not run on this host (its subjects were NOT inspected):');
  for (const u of coverage.unresolved) console.log(`  ?  ${u.key} — ${u.reason}`);
  if (ALLOW_EMPTY) { console.log('(skipped — --allow-empty / RUNNING_CONFIG_ALLOW_EMPTY=1)'); process.exit(0); }
  console.log('  Run this on the deploy host where the compose config resolves, or opt out deliberately:');
  console.log('    RUNNING_CONFIG_ALLOW_EMPTY=1 npm run guard:running-config');
  process.exit(2);
}
