import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * CI guard for Issue #2602: the promtail override in
 * deploy/docker-compose.preprod.yml defended its `!override` with prose that
 * measured wrong — a four-job config, an `nginx-logs` scrape job that does not
 * exist, and an nginx "writes real files into the volume" claim while the
 * volume held only the image's /dev/stdout symlinks. The dead
 * `nginx-logs:/var/log/nginx:ro` mount was worse than useless: inside the
 * promtail container that path resolves to promtail's OWN stdout, so any
 * future file-tailing job there would self-feed. The fix drops the mount and
 * deletes the zero-stream `postgres-logs` job (database is off-host).
 *
 * Prevention, per the issue: no prose check can see runtime state, but the
 * structural claims can — job inventory, mount inventory, and the specific
 * hazards, asserted against the committed files on every CI run.
 */

const ROOT = join(import.meta.dirname!, '..', '..');
const PREPROD = readFileSync(join(ROOT, 'deploy/docker-compose.preprod.yml'), 'utf8');
const PROMTAIL = readFileSync(join(ROOT, 'deploy/monitoring/promtail/promtail-config.yml'), 'utf8');

function serviceBlock(src: string, name: string): string {
  const m = src.match(
    new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-zA-Z][\\w-]*:|^\\S|(?![\\s\\S]))`, 'm'),
  );
  expect(m, `service block "${name}" not found`).not.toBeNull();
  return m![1];
}

describe('promtail-config.yml job inventory (#2602)', () => {
  const jobs = [...PROMTAIL.matchAll(/- job_name:\s*(\S+)/g)].map((m) => m[1]);

  it('defines exactly the docker job — no nginx-logs job ever, no inert postgres-logs job', () => {
    expect(jobs).toEqual(['docker']);
  });

  it('has no file-tailing job left (every removed job stays removed)', () => {
    expect(PROMTAIL).not.toMatch(/__path__/);
    expect(PROMTAIL).not.toMatch(/static_configs/);
  });

  it('keeps the self-ingestion drop rule the docker job needs', () => {
    expect(PROMTAIL).toMatch(/regex:\s*"\(promtail\|loki\)"/);
    expect(PROMTAIL).toMatch(/action:\s*"drop"/);
  });
});

describe('preprod promtail service (#2602)', () => {
  const block = serviceBlock(PREPROD, 'promtail');

  it('still replaces the base list with !override and keeps config + socket mounts', () => {
    expect(block).toContain('volumes: !override');
    expect(block).toMatch(/promtail-config\.yml:\/etc\/promtail\/promtail-config\.yml:ro/);
    expect(block).toMatch(/\/var\/run\/docker\.sock:\/var\/run\/docker\.sock:ro/);
  });

  // comment lines document the removed mounts by name, so assertions about
  // what the service does NOT mount must look at live YAML only
  const code = block.replace(/^\s*#.*$/gm, '');

  it('drops the host /var/log bind AND the dead nginx-logs mount', () => {
    expect(code).not.toMatch(/nginx-logs:\/var\/log\/nginx/);
    expect(code).not.toMatch(/^\s*-\s*\/var\/log:\/var\/log/m);
  });

  it('mounts nothing under /var/log — those paths resolve to symlinks to someone\'s stdout', () => {
    const mounts = [...code.matchAll(/^\s+-\s+(\S+)/gm)].map((m) => m[1]);
    expect(mounts.length).toBeGreaterThan(0);
    for (const mount of mounts) {
      const dest = mount.split(':')[1] ?? mount;
      expect(dest.startsWith('/var/log'), `mount ${mount} targets /var/log`).toBe(false);
    }
  });
});

describe('the defending comment tells measured truth (#2602)', () => {
  it('no longer claims four jobs or a file-writing nginx', () => {
    expect(PREPROD).not.toMatch(/four jobs in promtail-config/i);
    expect(PREPROD).not.toMatch(/nginx still writes real files/i);
  });

  it('records the re-pin and the hazard the mount was', () => {
    expect(PREPROD).toMatch(/#2602/);
    expect(PREPROD).toMatch(/zero log bytes/);
    expect(PROMTAIL).toMatch(/#2602/);
  });
});
