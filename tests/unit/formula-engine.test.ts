import { describe, it, expect } from 'vitest';
import { formulaEngine } from '../../lib/formula/engine';

describe('FormulaEngine', () => {
  it('evaluates simple math with variables', () => {
    const data = { value: 100, cost: 30 };
    const result = formulaEngine.evaluate('{{value}} - {{cost}}', data);
    expect(result).toBe(70);
  });

  it('handles nested data properties', () => {
    const data = {
      deal: { amount: 1000 },
      metadata: { margin: 0.15 }
    };
    const result = formulaEngine.evaluate('{{deal.amount}} * {{metadata.margin}}', data);
    expect(result).toBe(150);
  });

  it('performs string concatenation if expressions allow (requires expr-eval config, but simple strings work)', () => {
    const data = { score: 85 };
    const result = formulaEngine.evaluate('{{score}} + 10', data);
    expect(result).toBe(95);
  });

  it('rounds decimal results to 2 places', () => {
    const data = { val: 10, divisor: 3 };
    const result = formulaEngine.evaluate('{{val}} / {{divisor}}', data);
    expect(result).toBe(3.33);
  });

  it('returns null for invalid formulas', () => {
    const result = formulaEngine.evaluate('invalid + syntax', {});
    expect(result).toBe(null);
  });

  it('handles missing data by defaulting to 0', () => {
    const data = { val: 50 };
    const result = formulaEngine.evaluate('{{val}} + {{missing}}', data);
    expect(result).toBe(50);
  });

  it('handles complex order of operations', () => {
    const data = { a: 10, b: 2, c: 5 };
    const result = formulaEngine.evaluate('({{a}} + {{b}}) * {{c}}', data);
    expect(result).toBe(60);
  });

  it('returns null for empty formula', () => {
    const result = formulaEngine.evaluate('', { val: 1 });
    expect(result).toBe(null);
  });

  it('handles whitespace-only formula', () => {
    const result = formulaEngine.evaluate('   ', { val: 1 });
    expect(result).toBeUndefined();
  });

  it('blocks formulas longer than 1000 characters', () => {
    const longFormula = '1'.repeat(1001);
    const result = formulaEngine.evaluate(longFormula, {});
    expect(result).toBe(null);
  });

  it('allows formulas under 1000 character limit', () => {
    const formula = '{{val}} + 10';
    const data = { val: 5 };
    const result = formulaEngine.evaluate(formula, data);
    expect(result).toBe(15);
  });

  it('blocks import() dangerous pattern', () => {
    const result = formulaEngine.evaluate('import("fs")', {});
    expect(result).toBe(null);
  });

  it('blocks require() dangerous pattern', () => {
    const result = formulaEngine.evaluate('require("fs")', {});
    expect(result).toBe(null);
  });

  it('blocks process. dangerous pattern', () => {
    const result = formulaEngine.evaluate('process.env', {});
    expect(result).toBe(null);
  });

  it('blocks __proto__ dangerous pattern', () => {
    const result = formulaEngine.evaluate('__proto__', {});
    expect(result).toBe(null);
  });

  it('blocks constructor dangerous pattern', () => {
    const result = formulaEngine.evaluate('constructor', {});
    expect(result).toBe(null);
  });

  it('blocks prototype dangerous pattern', () => {
    const result = formulaEngine.evaluate('prototype', {});
    expect(result).toBe(null);
  });

  it('blocks eval() dangerous pattern', () => {
    const result = formulaEngine.evaluate('eval("1+1")', {});
    expect(result).toBe(null);
  });

  it('blocks Function() dangerous pattern', () => {
    const result = formulaEngine.evaluate('Function("return 1")', {});
    expect(result).toBe(null);
  });

  it('blocks global. dangerous pattern', () => {
    const result = formulaEngine.evaluate('global.process', {});
    expect(result).toBe(null);
  });

  it('returns null for string formulas (mathjs numeric-only instance)', () => {
    const result = formulaEngine.evaluate('"hello" + " " + "world"', {});
    expect(result).toBe(null);
  });

  it('handles null intermediate in nested value resolution', () => {
    const data = { a: null };
    const result = formulaEngine.evaluate('{{a.b}} + 5', data);
    expect(result).toBe(5);
  });

  it('handles undefined intermediate in nested value resolution', () => {
    const data = {};
    const result = formulaEngine.evaluate('{{a.b.c}} + 1', data);
    expect(result).toBe(1);
  });
});
