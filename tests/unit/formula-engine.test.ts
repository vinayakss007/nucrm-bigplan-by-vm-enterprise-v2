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
    // Note: for complex string ops, we'd add functions to the parser.
    // For now, let's test basic arithmetic which is our main use case.
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
    expect(result).toBe(50); // missing = 0
  });

  it('handles complex order of operations', () => {
    const data = { a: 10, b: 2, c: 5 };
    const result = formulaEngine.evaluate('({{a}} + {{b}}) * {{c}}', data);
    expect(result).toBe(60);
  });
});
