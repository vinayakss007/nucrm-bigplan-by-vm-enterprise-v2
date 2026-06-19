/**
 * Formula Engine — NuCRM No-Code Logic
 *
 * Safely evaluates user-defined formulas using CRM entity data.
 * Supports standard math, logic, and string concatenation.
 *
 * SECURITY: Uses mathjs with sandboxed evaluation (no access to global scope,
 * no prototype pollution, no arbitrary code execution). Previously used expr-eval
 * which had critical prototype pollution + code execution vulnerabilities
 * (GHSA-8gw3-rxh4-v6jx, GHSA-jc85-fpwf-qm7x) with NO fix available.
 */

import { create, all } from 'mathjs';

// Create a restricted mathjs instance — no dangerous functions
const math = create(all as any);

// Remove dangerous functions that could be abused
const BLOCKED_FUNCTIONS = [
  'import', 'createUnit',
  'simplify',
  'derivative', 'resolve', 'compile', 'chain',
];

for (const fn of BLOCKED_FUNCTIONS) {
  try {
    delete (math as unknown as Record<string, unknown>)[fn];
  } catch {
    // Fallback to default on corrupted storage data
  }
}

export class FormulaEngine {
  /**
   * Evaluate a formula against a data record.
   *
   * @param formula The user-defined string (e.g. "{{value}} * 0.1")
   * @param data The entity record (Contact, Deal, etc.)
   * @returns The computed value (number or string) or null on error
   */
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluate(formula: string, data: Record<string, any>): any {
    if (!formula) return null;

    try {
      // 1. Pre-process: replace {{field}} with clean variable names
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const variables: Record<string, any> = {};
      let cleanFormula = formula;

      const matches = formula.match(/\{\{([\w\.]+)\}\}/g);
      if (matches) {
        for (const match of matches) {
          const rawKey = match.slice(2, -2); // Remove {{ and }}
          const safeKey = rawKey.replace(/\./g, '_'); // Flatten nested paths

          cleanFormula = cleanFormula.replace(match, safeKey);
          const value = this.getNestedValue(data, rawKey);
          variables[safeKey] = typeof value === 'number' ? value : (parseFloat(value) || 0);
        }
      }

      // 2. Validate formula length (prevent DoS via extremely long formulas)
      if (cleanFormula.length > 1000) {
        console.error('[FormulaEngine] Formula too long (>1000 chars)');
        return null;
      }

      // 3. Block dangerous patterns
      const dangerousPatterns = [
        /import\s*\(/i,
        /require\s*\(/i,
        /process\./i,
        /global\./i,
        /__proto__/i,
        /constructor/i,
        /prototype/i,
        /eval\s*\(/i,
        /Function\s*\(/i,
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(cleanFormula)) {
          console.error(`[FormulaEngine] Blocked dangerous pattern in formula: "${cleanFormula}"`);
          return null;
        }
      }

      // 4. Evaluate safely with mathjs (sandboxed, no global access)
      const result = math.evaluate(cleanFormula, variables);

      // 5. Round numbers to avoid floating point weirdness
      if (typeof result === 'number') {
        return Math.round(result * 100) / 100;
      }

      return result;
    } catch (err) {
      console.error(`[FormulaEngine] Evaluation failed: "${formula}"`, err);
      return null;
    }
  }

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getNestedValue(obj: Record<string, any>, path: string): any {
    return path.split('.').reduce((acc, key) => acc?.[key], obj);
  }
}

export const formulaEngine = new FormulaEngine();
