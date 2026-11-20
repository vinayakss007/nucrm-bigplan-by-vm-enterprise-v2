/**
 * The strict release gate reaches the built app directly, with no nginx in
 * front of it. Auth-scoped rate limits fail closed when getClientIp() sees no
 * address (#2630), so the gate must declare a trusted proxy and the smoke test
 * must send one. Both halves are pinned here: a green gate is the only proof a
 * release is installable, and the first real run failed on exactly this pair.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const releaseYml = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
const smokeSh = readFileSync(join(root, 'scripts/smoke-test.sh'), 'utf8');
const clientIp = readFileSync(join(root, 'lib/client-ip.ts'), 'utf8');

describe('release gate proxy identity', () => {
  it('declares TRUST_PROXY=true in the gate job env', () => {
    const gate = releaseYml.split('  gate:')[1];
    expect(gate).toBeDefined();
    expect(gate).toMatch(/TRUST_PROXY:\s*["']?true["']?/);
  });

  it('sends a client IP header on the smoke login', () => {
    const login = smokeSh.split('# Test login API')[1];
    expect(login).toBeDefined();
    expect(login).toMatch(/X-Forwarded-For:\s*127\.0\.0\.1/);
  });

  it('only honors forwarded headers when the proxy is trusted', () => {
    expect(clientIp).toMatch(/TRUST_PROXY !== 'true'/);
    expect(clientIp).toMatch(/x-forwarded-for/);
  });
});
