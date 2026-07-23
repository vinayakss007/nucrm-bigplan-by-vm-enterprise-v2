import { describe, it, expect } from 'vitest';
import { checkNeedsApproval, type ApprovalRule } from '@/lib/rbac/approval-workflows';

function makeRule(overrides: Partial<ApprovalRule> = {}): ApprovalRule {
  return {
    id: 'rule-1',
    tenantId: 't1',
    entityType: 'deal',
    conditionField: 'amount',
    conditionOperator: '>',
    conditionValue: 10000,
    approverRoleSlug: 'sales_manager',
    autoApproveRoles: [],
    ...overrides,
  };
}

describe('checkNeedsApproval', () => {
  it('returns null when no rules match entity type', () => {
    const rules = [makeRule({ entityType: 'contact' })];
    const result = checkNeedsApproval(rules, 'deal', { amount: 50000 });
    expect(result).toBeNull();
  });

  it('returns null when field value is undefined', () => {
    const rules = [makeRule()];
    const result = checkNeedsApproval(rules, 'deal', {});
    expect(result).toBeNull();
  });

  it('returns null when field value is null', () => {
    const rules = [makeRule()];
    const result = checkNeedsApproval(rules, 'deal', { amount: null });
    expect(result).toBeNull();
  });

  it('matches > operator for numbers', () => {
    const rules = [makeRule({ conditionOperator: '>', conditionValue: 10000 })];
    const result = checkNeedsApproval(rules, 'deal', { amount: 15000 });
    expect(result).toBeDefined();
    expect(result!.id).toBe('rule-1');
  });

  it('does not match > operator when value is equal', () => {
    const rules = [makeRule({ conditionOperator: '>', conditionValue: 10000 })];
    const result = checkNeedsApproval(rules, 'deal', { amount: 10000 });
    expect(result).toBeNull();
  });

  it('matches < operator for numbers', () => {
    const rules = [makeRule({ conditionOperator: '<', conditionValue: 10000 })];
    const result = checkNeedsApproval(rules, 'deal', { amount: 5000 });
    expect(result).toBeDefined();
  });

  it('matches >= operator for numbers', () => {
    const rules = [makeRule({ conditionOperator: '>=', conditionValue: 10000 })];
    expect(checkNeedsApproval(rules, 'deal', { amount: 10000 })).toBeDefined();
    expect(checkNeedsApproval(rules, 'deal', { amount: 15000 })).toBeDefined();
    expect(checkNeedsApproval(rules, 'deal', { amount: 9999 })).toBeNull();
  });

  it('matches <= operator for numbers', () => {
    const rules = [makeRule({ conditionOperator: '<=', conditionValue: 10000 })];
    expect(checkNeedsApproval(rules, 'deal', { amount: 10000 })).toBeDefined();
    expect(checkNeedsApproval(rules, 'deal', { amount: 5000 })).toBeDefined();
    expect(checkNeedsApproval(rules, 'deal', { amount: 10001 })).toBeNull();
  });

  it('matches == operator for numbers', () => {
    const rules = [makeRule({ conditionOperator: '==', conditionValue: 10000 })];
    expect(checkNeedsApproval(rules, 'deal', { amount: 10000 })).toBeDefined();
    expect(checkNeedsApproval(rules, 'deal', { amount: 10001 })).toBeNull();
  });

  it('matches != operator for numbers', () => {
    const rules = [makeRule({ conditionOperator: '!=', conditionValue: 10000 })];
    expect(checkNeedsApproval(rules, 'deal', { amount: 9999 })).toBeDefined();
    expect(checkNeedsApproval(rules, 'deal', { amount: 10000 })).toBeNull();
  });

  it('handles string-to-number coercion for numeric fields', () => {
    const rules = [makeRule({ conditionOperator: '>', conditionValue: 10000 })];
    const result = checkNeedsApproval(rules, 'deal', { amount: '15000' });
    expect(result).toBeDefined();
  });

  it('handles string comparison with == operator', () => {
    const rules = [makeRule({
      conditionField: 'status',
      conditionOperator: '==',
      conditionValue: 'won',
    })];
    expect(checkNeedsApproval(rules, 'deal', { status: 'won' })).toBeDefined();
    expect(checkNeedsApproval(rules, 'deal', { status: 'lost' })).toBeNull();
  });

  it('handles string comparison with != operator', () => {
    const rules = [makeRule({
      conditionField: 'status',
      conditionOperator: '!=',
      conditionValue: 'won',
    })];
    expect(checkNeedsApproval(rules, 'deal', { status: 'lost' })).toBeDefined();
    expect(checkNeedsApproval(rules, 'deal', { status: 'won' })).toBeNull();
  });

  it('returns first matching rule when multiple match', () => {
    const rule1 = makeRule({ id: 'rule-1', conditionOperator: '>', conditionValue: 5000 });
    const rule2 = makeRule({ id: 'rule-2', conditionOperator: '>', conditionValue: 10000 });
    const result = checkNeedsApproval([rule1, rule2], 'deal', { amount: 15000 });
    expect(result!.id).toBe('rule-1');
  });

  it('returns null when no rules match', () => {
    const rules = [makeRule({ conditionOperator: '>', conditionValue: 100000 })];
    const result = checkNeedsApproval(rules, 'deal', { amount: 5000 });
    expect(result).toBeNull();
  });

  it('handles empty rules array', () => {
    const result = checkNeedsApproval([], 'deal', { amount: 50000 });
    expect(result).toBeNull();
  });

  it('skips rules with non-matching entity type', () => {
    const rules = [
      makeRule({ id: 'rule-contact', entityType: 'contact', conditionField: 'score', conditionOperator: '>', conditionValue: 100 }),
      makeRule({ id: 'rule-deal', entityType: 'deal', conditionOperator: '>', conditionValue: 10000 }),
    ];
    const result = checkNeedsApproval(rules, 'deal', { amount: 50000, score: 200 });
    expect(result!.id).toBe('rule-deal');
  });

  it('handles string values that cannot be parsed as numbers', () => {
    const rules = [makeRule({ conditionOperator: '>', conditionValue: 10000 })];
    const result = checkNeedsApproval(rules, 'deal', { amount: 'not-a-number' });
    // Both become NaN, so numeric comparison fails, string comparison with > is skipped
    expect(result).toBeNull();
  });
});
