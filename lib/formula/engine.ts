import { Parser } from 'expr-eval';

/**
 * Formula Engine — NuCRM No-Code Logic
 * 
 * Safely evaluates user-defined formulas using CRM entity data.
 * Supports standard math, logic, and string concatenation.
 */

export class FormulaEngine {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
  }

  /**
   * Evaluate a formula against a data record.
   * 
   * @param formula The user-defined string (e.g. "{{value}} * 0.1")
   * @param data The entity record (Contact, Deal, etc.)
   * @returns The computed value (number or string) or null on error
   */
  evaluate(formula: string, data: Record<string, any>): any {
    if (!formula) return null;

    try {
      // 1. Pre-process: replace {{field}} with clean variable names
      // We also track which variables we've extracted to pass to the parser
      const variables: Record<string, any> = {};
      let cleanFormula = formula;

      const matches = formula.match(/\{\{([\w\.]+)\}\}/g);
      if (matches) {
        for (const match of matches) {
          const rawKey = match.slice(2, -2); // Remove {{ and }}
          const safeKey = rawKey.replace(/\./g, '_'); // Flatten nested paths
          
          cleanFormula = cleanFormula.replace(match, safeKey);
          variables[safeKey] = this.getNestedValue(data, rawKey) ?? 0;
        }
      }

      // 2. Parse and evaluate
      // expr-eval is safe as it doesn't allow arbitrary JS execution
      const expression = this.parser.parse(cleanFormula);
      const result = expression.evaluate(variables);

      // 3. Round numbers to avoid floating point weirdness
      if (typeof result === 'number') {
        return Math.round(result * 100) / 100;
      }

      return result;
    } catch (err) {
      console.error(`[FormulaEngine] Evaluation failed: "${formula}"`, err);
      return null;
    }
  }

  private getNestedValue(obj: Record<string, any>, path: string): any {
    return path.split('.').reduce((acc, key) => acc?.[key], obj);
  }
}

export const formulaEngine = new FormulaEngine();
