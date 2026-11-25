import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VARS = readFileSync(join(process.cwd(), 'deploy/terraform/variables.tf'), 'utf8');
const EXAMPLE = readFileSync(join(process.cwd(), 'deploy/terraform/terraform.tfvars.example'), 'utf8');
const FIREWALL = readFileSync(join(process.cwd(), 'deploy/terraform/firewall.tf'), 'utf8');

function variableBlock(name: string): string {
  const start = VARS.indexOf(`variable "${name}"`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = VARS.indexOf('\n}', start);
  return end === -1 ? VARS.slice(start) : VARS.slice(start, end + 2);
}

describe('terraform never opens SSH by default (#3846)', () => {
  const block = variableBlock('admin_cidrs');

  it('has no open default', () => {
    expect(block).not.toMatch(/^\s*default\s*=/m);
  });

  it('rejects any /0 network and an empty list', () => {
    expect(block).toContain('length(var.admin_cidrs) > 0');
    expect(block).toContain('regex("/0$", cidr)');
    expect(block).toContain('error_message');
  });

  it('still feeds both provider firewall rules', () => {
    expect(FIREWALL.match(/source_ips\s*=\s*var\.admin_cidrs|source_addresses\s*=\s*var\.admin_cidrs/g)).toHaveLength(2);
  });

  it('ships a concrete non-open example value', () => {
    expect(EXAMPLE).toMatch(/^admin_cidrs\s*=\s*\["203\.0\.113\.10\/32"\]$/m);
  });
});
