import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ACCEPTED_METHODS,
  WEAK_METHODS,
  checkComposeAuthPins,
  checkPgHbaRules,
  findComposeFiles,
  isPostgresImage,
  parsePgHba,
  readComposeServices,
  runGuard,
} from '../../scripts/check-pg-hba.mjs';

const ROOT = join(import.meta.dirname!, '..', '..');
const HBA = 'deploy/postgres/pg_hba.conf';

/** A compose fragment with one Postgres service and the given `environment:` entries. */
const block = (...entries: string[]) => `
services:
  web:
    image: node:22
    environment:
      - DATABASE_URL=x
  postgres:
    image: postgres:16-alpine
    environment:
${entries.map((e) => `      - ${e}`).join('\n')}
    volumes:
      - pgdata:/var/lib/postgresql/data
`;

const PINNED = [
  'POSTGRES_DB=nucrm',
  'POSTGRES_PASSWORD=x',
  'POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
  'POSTGRES_INITDB_ARGS=--auth-local=scram-sha-256 --auth-host=scram-sha-256',
];

const pinProblems = (entries: string[]) =>
  checkComposeAuthPins('test.yml', readComposeServices(block(...entries))).flatMap((u) => u.problems);

describe('#3265 — the shipped pg_hba is a deployment artifact, not a data-directory accident', () => {
  it('parses every rule of the tracked file with no malformed line', () => {
    const { rules, errors } = parsePgHba(readFileSync(join(ROOT, HBA), 'utf8'));
    expect(errors).toEqual([]);
    expect(rules.length).toBeGreaterThanOrEqual(6);
    expect(rules.every((r) => r.line > 0)).toBe(true);
  });

  it('requires a credential on every rule it declares', () => {
    const { rules, errors } = parsePgHba(readFileSync(join(ROOT, HBA), 'utf8'));
    expect(checkPgHbaRules(rules, errors)).toEqual([]);
    for (const rule of rules) {
      expect(ACCEPTED_METHODS.has(rule.method)).toBe(true);
      expect(WEAK_METHODS.has(rule.method)).toBe(false);
    }
    expect(rules.some((r) => r.type === 'local' && r.method === 'peer')).toBe(true);
    expect(rules.some((r) => r.type === 'hostssl' && r.method === 'scram-sha-256')).toBe(true);
  });

});

describe('#3265 — the screen refuses weaker text than the policy', () => {
  const rules = (text: string) => parsePgHba(text);

  it('flags trust, md5 and cleartext password', () => {
    for (const method of ['trust', 'md5', 'password']) {
      const { rules: r, errors } = rules(`host all all 127.0.0.1/32 ${method}`);
      expect(checkPgHbaRules(r, errors).join('\n')).toContain(method);
    }
  });

  it('flags an unknown method rather than accepting anything not on the weak list', () => {
    const { rules: r, errors } = rules('host all all 127.0.0.1/32 gss);'.replace(');', ''));
    expect(checkPgHbaRules(r, errors).join('\n')).toContain('not a method this repo declares');
  });

  it('refuses a file whose rules parse to nothing', () => {
    // The failure mode this whole issue is: a scan that matches nothing reports clean.
    expect(checkPgHbaRules([], [])).toEqual([
      expect.stringContaining('no rule parsed'),
      expect.stringContaining('no rule requires scram-sha-256'),
    ]);
  });

  it('counts a malformed local rule as a problem instead of guessing the method', () => {
    const { rules: r, errors } = rules('local all all');
    expect(errors).toHaveLength(1);
    expect(checkPgHbaRules(r, errors).join('\n')).toContain('needs type, database, user, method');
  });

  it('flags a host rule missing its address field', () => {
    const { rules: r, errors } = rules('host all all scram-sha-256');
    expect(checkPgHbaRules(r, errors).join('\n')).toContain('a host rule needs type');
  });
});

describe('#3265 — every Postgres service pins the auth method for a new volume', () => {
  it('the real tree is pinned and the guard passes', () => {
    const result = runGuard({ root: ROOT, quiet: true });
    expect(result.ok).toBe(true);
    expect(result.unpinned).toEqual([]);
    expect(result.problems).toEqual([]);
    expect(result.composeFiles.length).toBeGreaterThanOrEqual(5);
    expect(result.hbaRules).toBeGreaterThanOrEqual(6);
  });

  it('reads the services that actually exist, and only those', () => {
    const files = ['docker-compose.yml', 'docker-compose.scale.yml', 'docker-compose.slim.yml'];
    for (const file of files) {
      const services = readComposeServices(readFileSync(join(ROOT, file), 'utf8'));
      expect(services, file).toHaveLength(1);
      expect(services[0].name, file).toBe('postgres');
      expect(services[0].env['POSTGRES_INITDB_ARGS'], file).toBe(
        '--auth-local=scram-sha-256 --auth-host=scram-sha-256',
      );
      expect(services[0].env['POSTGRES_HOST_AUTH_METHOD'], file).toBe('scram-sha-256');
    }
  });

  it('names the service when the pin is dropped', () => {
    const problems = pinProblems(['POSTGRES_DB=nucrm', 'POSTGRES_PASSWORD=x']);
    expect(problems.join('\n')).toContain('--auth-local is not set');
    expect(problems.join('\n')).toContain('--auth-host is not set');
    expect(problems.join('\n')).toContain('POSTGRES_HOST_AUTH_METHOD is unset');
    expect(problems).toHaveLength(3);
  });

  it('names the half that was pinned alone', () => {
    const problems = pinProblems([
      'POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
      'POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256',
    ]);
    expect(problems).toEqual([expect.stringContaining('--auth-local is not set')]);
  });

  it('refuses a pin that names trust', () => {
    const problems = pinProblems([
      'POSTGRES_HOST_AUTH_METHOD=trust',
      'POSTGRES_INITDB_ARGS=--auth-local=trust --auth-host=scram-sha-256',
    ]);
    expect(problems.join('\n')).toContain('--auth-local=trust is weaker');
    expect(problems.join('\n')).toContain('POSTGRES_HOST_AUTH_METHOD=trust is weaker');
  });

  it('refuses a value it does not recognise rather than treating unknown as safe', () => {
    const problems = pinProblems([
      'POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
      'POSTGRES_INITDB_ARGS=--auth-local=certs --auth-host=scram-sha-256',
    ]);
    expect(problems).toEqual([expect.stringContaining('--auth-local=certs is weaker')]);
  });

  it('reads the map form of environment: as well as the list form', () => {
    const content = [
      'services:',
      '  db:',
      '    image: postgres:16',
      '    environment:',
      '      POSTGRES_HOST_AUTH_METHOD: scram-sha-256',
      '      POSTGRES_INITDB_ARGS: --auth-local=scram-sha-256 --auth-host=scram-sha-256',
    ].join('\n');
    const services = readComposeServices(content);
    expect(services).toHaveLength(1);
    expect(services[0].env['POSTGRES_INITDB_ARGS']).toContain('--auth-local=scram-sha-256');
    expect(checkComposeAuthPins('map.yml', services)).toEqual([]);
  });

  it('does not mistake an exporter or a pooler for a database server', () => {
    expect(isPostgresImage('postgres:16-alpine')).toBe(true);
    expect(isPostgresImage('docker.io/library/postgres:16')).toBe(true);
    expect(isPostgresImage('postgres')).toBe(true);
    expect(isPostgresImage('prometheuscommunity/postgres-exporter')).toBe(false);
    expect(isPostgresImage('edoburu/pgbouncer:latest')).toBe(false);
    expect(isPostgresImage('redis:7-alpine')).toBe(false);
    expect(isPostgresImage(null)).toBe(false);
  });

  it('does not harvest another service environment into the Postgres one', () => {
    const services = readComposeServices(block(...PINNED));
    expect(services.map((s) => s.name)).toEqual(['postgres']);
    expect(services[0].env['DATABASE_URL']).toBeUndefined();
  });

  it('finds compose files without walking node_modules', () => {
    const files = findComposeFiles(ROOT);
    expect(files).toContain('docker-compose.yml');
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
  });
});

describe('#3265 — the boot path asks the question it claims to ask', () => {
  const health = readFileSync(join(ROOT, 'deploy/scripts/health-check.sh'), 'utf8');

  it('probes authentication, not just readiness', () => {
    expect(health).toContain('pg_auth_check');
    expect(health).toContain('accepted a session with no credential');
    expect(health).toContain('deploy/postgres/pg_hba.conf');
    // The verdict must be issuable: a probe that finds nothing reports failure, not OK.
    expect(health).toContain('no running postgres container to ask');
  });

  it('no longer names a container no compose file creates', () => {
    expect(health).not.toContain('nucrm-postgres');
    expect(health).toContain('$2 ~ /^postgres(:|$)/');
  });

  it('keeps the credential inside the container on both dependent paths', () => {
    for (const file of ['scripts/backup-db.sh', 'postman/full-test-suite.sh']) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      expect(text, file).toContain('PGPASSWORD="$POSTGRES_PASSWORD"');
      // The bad form is `-e PGPASSWORD=$POSTGRES_PASSWORD` on the docker command line:
      // the host shell expands it, so it lands in this machine's process arguments
      // where any local `ps` reads it. Matched against `docker` invocations only — a
      // comment naming the mistake is how the fix gets explained (backup-db.sh does
      // exactly that), and a screen that flags prose teaches people to delete prose.
      const dockerLines = text.split('\n').filter((line) => /^\s*[^#]*\bdocker\b/.test(line));
      expect(dockerLines.length, file).toBeGreaterThan(0);
      for (const line of dockerLines) {
        expect(line, `${file}: ${line.trim()}`).not.toMatch(/-e\s+PGPASSWORD=\$?\{?POSTGRES_PASSWORD/);
      }
    }
  });
});

describe('#3265 — the guard is wired, not just written', () => {
  it('is a package.json alias and a scheduled workflow step', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['guard:pg-hba']).toBe('node scripts/check-pg-hba.mjs');
    const soak = readFileSync(join(ROOT, '.github/workflows/nightly-soak.yml'), 'utf8');
    expect(soak).toContain('npm run guard:pg-hba');
  });

  it('the CLI itself exits 0 on this tree', () => {
    const r = spawnSync('node', [join(ROOT, 'scripts', 'check-pg-hba.mjs')], { encoding: 'utf8' });
    expect(r.stdout).toContain('Postgres service(s)');
    expect(r.status).toBe(0);
  });
});
