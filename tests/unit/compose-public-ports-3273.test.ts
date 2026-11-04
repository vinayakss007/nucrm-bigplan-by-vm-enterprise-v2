import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  findComposeFiles,
  isLoopbackBind,
  parseMapping,
  readPortMappings,
  runGuard,
  scanComposeFiles,
} from '../../scripts/check-compose-public-ports.mjs';

/**
 * #3273: a compose `ports:` entry with no bind address publishes on every
 * interface. The tree's own screen is half the fix, so it gets the must-see /
 * must-refuse treatment — a scanner whose pattern matches nothing also reports
 * "all clear", and that is the failure mode this issue is.
 */

const ROOT = join(import.meta.dirname!, '..', '..');
const ALLOWLIST = JSON.parse(readFileSync(join(ROOT, 'scripts/compose-public-ports-allowlist.json'), 'utf8'));

const file = (content: string) => [{ path: 'docker-compose.yml', content }];
const block = (...entries: string[]) =>
  [
    'services:',
    '  app:',
    '    ports:',
    ...entries.map((e) => `      - ${e}`),
    '    environment:',
  ].join('\n');
const why = (content: string, entries: unknown[] = []) =>
  scanComposeFiles(file(content), entries as never[]).violations.map((v) => `${v.service}:${v.value}:${v.why}`);

describe('compose published-ports guard (#3273)', () => {
  it('finds the shipped compose files and reports the whole tree clean', () => {
    const result = runGuard({ root: ROOT, quiet: true });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.files.length).toBeGreaterThanOrEqual(5);
    // A floor, not an exact count: a walk that quietly stops reading compose
    // files would otherwise still return an empty violation list.
    expect(result.mappings.length).toBeGreaterThanOrEqual(28);
    expect(result.allowed.sort()).toEqual(
      [
        'deploy/docker-compose.production.yml :: nginx :: ${NUCRM_PUBLIC_PORT:-80}:80',
        'deploy/docker-compose.production.yml :: nginx :: ${NUCRM_PUBLIC_SSL_PORT:-443}:443',
        'docker-compose.scale.yml :: nginx :: ${NUCRM_PUBLIC_PORT:-80}:80',
        'docker-compose.scale.yml :: nginx :: ${NUCRM_PUBLIC_SSL_PORT:-443}:443',
      ].sort(),
    );
  });

  it('keeps the two mappings this issue was about bound to loopback', () => {
    const scale = readFileSync(join(ROOT, 'docker-compose.scale.yml'), 'utf8');
    const dataPlane = readPortMappings(scale)
      .filter((e) => e.service === 'postgres' || e.service === 'redis')
      .map((e) => ({ service: e.service, bind: parseMapping(e.value).bind }));
    expect(dataPlane).toEqual([
      { service: 'postgres', bind: '127.0.0.1' },
      { service: 'redis', bind: '127.0.0.1' },
    ]);
  });

  it('sees the public mapping and accepts the loopback one', () => {
    expect(why(block('"127.0.0.1:5432:5432"'))).toEqual([]);
    expect(why(block('"5432:5432"'))).toEqual(['app:5432:5432:published on every interface']);
  });

  it('reads an entry that sits below a comment inside the block', () => {
    // `docker-compose.yml:185-187` has exactly this shape. A parser that treats
    // the comment as the end of the block reports this file as having no ports.
    const content = [
      'services:',
      '  db:',
      '    ports:',
      '      # Restrict to localhost only',
      '',
      '      - "127.0.0.1:5432:5432"',
      '    volumes:',
    ].join('\n');
    expect(readPortMappings(content)).toHaveLength(1);
    expect(why(content)).toEqual([]);
    expect(why(content.replace('127.0.0.1:', ''))).toEqual(['db:5432:5432:published on every interface']);
  });

  it('splits on top-level colons only', () => {
    expect(parseMapping('"127.0.0.1:${POSTGRES_PORT:-5432}:5432"')).toMatchObject({
      bind: '127.0.0.1',
      host: '${POSTGRES_PORT:-5432}',
      container: '5432',
    });
    expect(parseMapping('${REDIS_PORT:-6379}:6379')).toMatchObject({ bind: null, host: '${REDIS_PORT:-6379}' });
    expect(parseMapping('[::1]:9100:9100')).toMatchObject({ bind: '[::1]', host: '9100' });
    expect(parseMapping('8000-8010:8000-8010/udp')).toMatchObject({ bind: null, host: '8000-8010' });
  });

  it('names every shape that reaches the host from outside', () => {
    expect(why(block('8080:80'))).toEqual(['app:8080:80:published on every interface']);
    expect(why(block('"8000"'))).toEqual(['app:8000:random host port on every interface']);
    expect(why(block('"0.0.0.0:5432:5432"'))).toEqual(['app:0.0.0.0:5432:5432:bind is not loopback']);
    expect(why(block('"192.168.1.10:5432:5432"'))).toEqual(['app:192.168.1.10:5432:5432:bind is not loopback']);
    // A bind the scan cannot resolve is a bind the scan cannot vouch for.
    expect(why(block('"${LISTEN_IP}:5432:5432"'))).toEqual(['app:${LISTEN_IP}:5432:5432:bind is not loopback']);
    expect(why(block('"a:b:c:d"'))).toEqual(['app:a:b:c:d:not a mapping compose can be read']);
  });

  it('accepts the addresses that are genuinely loopback', () => {
    for (const bind of ['127.0.0.1', '127.3.4.5', 'localhost', '[::1]', '::1']) {
      expect(isLoopbackBind(bind), bind).toBe(true);
    }
    for (const bind of ['0.0.0.0', '', null, undefined, '10.0.0.1', '${LISTEN_IP}']) {
      expect(isLoopbackBind(bind as string | null), String(bind)).toBe(false);
    }
    expect(why(block('"[::1]:9100:9100"'))).toEqual([]);
    expect(why(block('"localhost:5432:5432"'))).toEqual([]);
  });

  it('reads long syntax, and does not invent a published port that is not there', () => {
    const long = [
      'services:',
      '  edge:',
      '    ports:',
      '      - target: 80',
      '        published: "8080"',
      '        mode: host',
      '',
    ].join('\n');
    expect(why(long)).toEqual(['edge::8080:published on every interface']);
    expect(why(long.replace('mode: host', 'host_ip: 127.0.0.1'))).toEqual([]);
    expect(scanComposeFiles(file(long.replace('        published: "8080"\n', ''))).mappings).toEqual([]);
  });

  it('honours an allowlist entry keyed by file, service and mapping — and says when one goes stale', () => {
    const content = block('"${NUCRM_PUBLIC_PORT:-80}:80"');
    const entry = { file: 'docker-compose.yml', service: 'app', mapping: '${NUCRM_PUBLIC_PORT:-80}:80', reason: 'front door' };
    expect(why(content, [entry])).toEqual([]);
    expect(scanComposeFiles(file(content), [entry]).stale).toEqual([]);

    // The same mapping under a different service is a different claim.
    const wrongService = scanComposeFiles(file(content), [{ ...entry, service: 'nginx' }]);
    expect(wrongService.violations.map((v) => v.value)).toEqual(['${NUCRM_PUBLIC_PORT:-80}:80']);
    expect(wrongService.stale).toHaveLength(1);
  });

  it('lists only a real public service, each with a reason that says something', () => {
    expect(ALLOWLIST.entries.map((e: { service: string }) => e.service).sort()).toEqual([
      'nginx',
      'nginx',
      'nginx',
      'nginx',
    ]);
    for (const e of ALLOWLIST.entries) {
      expect(e.reason.length, `${e.file} ${e.mapping}`).toBeGreaterThan(15);
      expect(e.mapping).toMatch(/:(80|443)$/);
    }
  });

  it('refuses to call an unreadable tree clean', () => {
    const empty = mkdtempSync(join(tmpdir(), 'vm3273-ports-'));
    try {
      writeFileSync(join(empty, 'README.md'), 'nothing here');
      expect(findComposeFiles(empty)).toEqual([]);
      const result = runGuard({ root: empty, quiet: true });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('no-compose-files');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('is wired as a guard script and runs as a workflow step, so the wiring cannot vanish quietly', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['guard:compose-ports']).toBe('node scripts/check-compose-public-ports.mjs');
    // The census tests (#3280/#3281/#3282) hold the unwired set to exactly one alias, so a
    // guard that stops being invoked somewhere turns those red rather than this one.
    const soak = readFileSync(join(ROOT, '.github/workflows/nightly-soak.yml'), 'utf8');
    expect(soak).toContain('npm run guard:compose-ports');
    expect(execFileSync('node', ['scripts/check-compose-public-ports.mjs'], { cwd: ROOT }).toString()).toContain(
      '0 violation(s)',
    );
  });
});
