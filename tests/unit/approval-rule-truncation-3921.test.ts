import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'lib/rbac/approval-producer.ts'), 'utf8');
const start = src.indexOf('async function findMatchingApprovalRule');
const end = src.indexOf('\nexport type StageResult', start);
const fn = src.slice(start, end);

describe('approval rules cannot be silently truncated (#3921)', () => {
  it('reads the full active rule set in a deterministic order', () => {
    expect(fn).toContain('.orderBy(approvalRules.id)');
    expect(fn).not.toContain('.limit(');
  });

  it('still scopes the rules to the tenant and live rows', () => {
    expect(fn).toContain('eq(approvalRules.tenantId, tenantId)');
    expect(fn).toContain('eq(approvalRules.isActive, true)');
    expect(fn).toContain('isNull(approvalRules.deletedAt)');
  });
});
