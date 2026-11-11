/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Compose published-ports guard (#3273).
 *
 * `docker compose -f docker-compose.scale.yml up` published Postgres and Redis
 * on every interface, because a mapping with no bind address means
 * `0.0.0.0:host:container`. The launch runbook (§1) told the operator those
 * ports are "bound to 127.0.0.1 by compose" and every sibling compose file had
 * honoured that — the scale file alone had not, which is how a stale checklist
 * sentence hides an open database.
 *
 * So the claim is checked at the source: every `ports:` entry in every tracked
 * compose file must bind loopback, or appear in
 * scripts/compose-public-ports-allowlist.json with a reason (that is nginx's
 * 80/443, which is the point of the deployment).
 *
 * Two things it refuses rather than guesses at:
 *   - a bind written as a variable (`${LISTEN_IP}:5432:5432`), because the scan
 *     cannot tell what it resolves to;
 *   - a mapping it cannot parse. `split(':')` is wrong here — `${VAR:-80}` has
 *     a colon inside it and IPv6 has several — so the field count drives the
 *     answer and anything unexpected fails closed.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST_PATH = join('scripts', 'compose-public-ports-allowlist.json');

/** Every compose file the repo ships, in the two directories they live in. */
export function findComposeFiles(root = ROOT) {
  const found = [];
  for (const dir of ['', 'deploy']) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs).sort()) {
      if (/^docker-compose[^/]*\.(yml|yaml)$/.test(name)) {
        found.push(posix.join(dir, name).replace(/^\.\//, ''));
      }
    }
  }
  return found;
}

/** Split on colons that are outside `${...}` and outside an `[::1]` group. */
export function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
    if (ch === ':' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

const unquote = (s) => String(s).trim().replace(/^["']|["']$/g, '');

/**
 * A short-syntax `ports:` entry as compose means it:
 *   `container`            → random host port, every interface
 *   `host:container`       → every interface
 *   `bind:host:container`  → that bind address only
 * Ranges (`8000-8010:80`) and the `/udp` suffix stay inside the strings; the
 * check only needs the field count, never the numbers.
 */
export function parseMapping(value) {
  const bare = unquote(String(value).trim().replace(/\/(tcp|udp)$/i, ''));
  const parts = splitTopLevel(bare).map((p) => p.trim());
  if (parts.length === 1) return { bind: null, host: null, container: parts[0], bare };
  if (parts.length === 2) return { bind: null, host: parts[0], container: parts[1], bare };
  if (parts.length === 3) return { bind: parts[0], host: parts[1], container: parts[2], bare };
  return { bind: undefined, host: undefined, container: undefined, bare };
}

export function isLoopbackBind(bind) {
  if (typeof bind !== 'string' || bind === '') return false;
  const ip = bind.replace(/^\[|\]$/g, '');
  if (ip === 'localhost' || ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
  return /^127(\.\d{1,3}){3}$/.test(ip);
}

/** Long syntax: `- target: 80` / `published: "8080"` / `host_ip: 127.0.0.1`. */
function applyLongKey(item, body) {
  const kv = body.match(/^([A-Za-z_]+):\s*(.*)$/);
  if (!kv) return;
  const value = unquote(kv[2]);
  if (kv[1] === 'target') item.target = value;
  if (kv[1] === 'published') item.published = value;
  if (kv[1] === 'host_ip') item.host_ip = value;
}

/**
 * Reads the `ports:` blocks. A comment or a blank line between `ports:` and its
 * entries does not end the block — one sits in `docker-compose.yml` today, and a
 * parser that stopped there silently skipped a database mapping while reporting
 * "all clear". The service name is taken from the two-space key above the block,
 * which is what the allowlist keys on.
 */
export function readPortMappings(content) {
  const lines = String(content).split('\n');
  const entries = [];
  let service = '';
  let i = 0;

  const ind = (line) => line.length - line.trimStart().length;

  while (i < lines.length) {
    const text = lines[i].trim();
    const indent = ind(lines[i]);
    const key = text.match(/^([A-Za-z0-9_.-]+):\s*(#.*)?$/);
    if (key && indent === 2) service = key[1];

    if (text !== 'ports:' || indent === 0) {
      i += 1;
      continue;
    }

    const blockIndent = indent;
    i += 1;
    let item = null;
    while (i < lines.length) {
      const raw = lines[i];
      const body = raw.trim();
      if (body === '' || body.startsWith('#')) {
        i += 1;
        continue;
      }
      if (ind(raw) <= blockIndent) break;
      const dash = body.match(/^-\s*(.*)$/);
      if (dash) {
        if (item) entries.push(item);
        if (/^target\s*:/.test(dash[1])) {
          item = { line: i + 1, service, long: true, published: null, host_ip: null };
          applyLongKey(item, dash[1]);
        } else {
          item = { line: i + 1, service, value: dash[1] };
        }
      } else if (item && item.long) {
        applyLongKey(item, body);
      }
      i += 1;
    }
    if (item) entries.push(item);
  }
  return entries;
}

export function mappingKey(record) {
  return `${record.file} :: ${record.service} :: ${record.value}`;
}

/**
 * @param {{path: string, content: string}[]} files
 * @param {{file: string, service: string, mapping: string, reason: string}[]} allowlistEntries
 */
export function scanComposeFiles(files, allowlistEntries = []) {
  const mappings = [];
  const violations = [];
  const accepted = new Set(
    allowlistEntries.map((e) => `${e.file} :: ${e.service} :: ${e.mapping}`),
  );
  const matched = new Set();

  for (const file of files) {
    for (const entry of readPortMappings(file.content)) {
      const isLong = entry.long === true;
      // Long syntax with no `published:` maps nothing onto the host.
      if (isLong && !entry.published) continue;
      const value = isLong ? `${entry.host_ip ?? ''}:${entry.published}` : unquote(entry.value);
      const parsed = isLong
        ? { bind: entry.host_ip ?? null, host: entry.published, container: entry.target, bare: value }
        : parseMapping(entry.value);
      const record = { file: file.path, line: entry.line, service: entry.service, value, ...parsed };
      mappings.push(record);

      let why = null;
      if (record.bind === undefined) {
        why = 'not a mapping compose can be read';
      } else if (record.host === null) {
        why = 'random host port on every interface';
      } else if (!isLoopbackBind(record.bind)) {
        const key = mappingKey(record);
        if (accepted.has(key)) {
          matched.add(key);
          continue;
        }
        why = record.bind === null ? 'published on every interface' : 'bind is not loopback';
      }
      if (why) violations.push({ ...record, why });
    }
  }

  const stale = [...accepted].filter((key) => !matched.has(key));
  return { mappings, violations, allowed: [...matched], stale };
}

export function readAllowlist(root = ROOT) {
  const path = join(root, ALLOWLIST_PATH);
  if (!existsSync(path)) return { entries: [] };
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function runGuard({ root = ROOT, quiet = false } = {}) {
  const paths = findComposeFiles(root);
  if (paths.length === 0) {
    if (!quiet) {
      console.error('compose-ports guard: found no compose files, which is not the same as finding none needed.');
    }
    return { ok: false, reason: 'no-compose-files', files: [], mappings: [], violations: [], stale: [] };
  }

  const files = paths.map((p) => ({ path: p, content: readFileSync(join(root, p), 'utf8') }));
  const { entries } = readAllowlist(root);
  const { mappings, violations, allowed, stale } = scanComposeFiles(files, entries);

  if (!quiet) {
    console.log(
      `compose-ports guard: ${files.length} compose file(s), ${mappings.length} published mapping(s), ` +
        `${allowed.length} allowlisted, ${violations.length} violation(s).`,
    );
    for (const v of violations) {
      console.log(`  [UNEXPECTED] ${v.file}:${v.line} [${v.service}] "${v.value}" — ${v.why}`);
    }
    if (stale.length) {
      console.log(`\n${stale.length} allowlist entry/entries no longer match a published mapping — prune them:`);
      stale.forEach((s) => console.log(`  ${s}`));
    }
    if (violations.length) {
      console.error(
        '\nFAIL: a compose `ports:` entry is reachable from outside the host.\n' +
          'An entry with no bind address means `0.0.0.0:host:container`; name the address instead:\n' +
          '  - "127.0.0.1:5432:5432"\n' +
          `A service meant to be public goes in ${ALLOWLIST_PATH} with a reason.`,
      );
    } else {
      console.log('OK: every published port binds loopback or is an allowlisted public service.');
    }
  }

  return { ok: violations.length === 0, files: paths, mappings, violations, allowed, stale };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(runGuard().ok ? 0 : 1);
}
