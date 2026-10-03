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

const drift = [];
const ok = [];
const unchecked = [];

for (const name of containers()) {
  for (const m of fileMounts(name)) {
    if (m.skipped) { unchecked.push(`${name}  ${m.src} — ${m.skipped}`); continue; }
    const host = sh(resolve(m.src));
    const ctr = remoteDigest(name, m.dst);
    if (ctr === null) { unchecked.push(`${name}  ${m.src} — container cannot read ${m.dst}`); continue; }
    if (host === ctr) ok.push(`${name}  ${m.dst}`);
    else drift.push({ name, src: m.src, dst: m.dst, host, ctr });
  }
}

console.log(`running-config drift: ${ok.length} identical · ${drift.length} drifted · ${unchecked.length} unchecked`);
for (const d of drift) {
  console.log(`  DRIFT  ${d.name}  ${d.src}\n         repo=${d.host} running=${d.ctr} — the container is NOT serving the committed file`);
}
for (const u of unchecked) console.log(`  ?      ${u}`);

if (drift.length > 0) {
  // Compose takes SERVICE names, not container names, so the command printed
  // here is copy-pasteable.
  const services = [...new Set(drift.map((d) => execFileSync('docker', ['inspect', '-f',
    '{{ index .Config.Labels "com.docker.compose.service" }}', d.name],
  { encoding: 'utf8' }).trim() || d.name))];
  console.log('\n  A reload cannot fix this — a file bind mount pins an inode, so only recreation re-attaches it:');
  console.log(`    cd deploy && docker compose -f docker-compose.production.yml -f docker-compose.preprod.yml up -d --force-recreate ${services.join(' ')}`);
  process.exit(1);
}
