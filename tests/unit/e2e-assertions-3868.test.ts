import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const specs = ['notifications.spec.ts', 'contacts.spec.ts', 'deals.spec.ts'].map((f) => ({
  file: f,
  src: readFileSync(join(process.cwd(), 'tests/e2e', f), 'utf8'),
}));
const audit = readFileSync(join(process.cwd(), 'tests/audit-runtime.spec.ts'), 'utf8');

function testsIn(src: string): string[] {
  return src.split(/\n\s*test\(/).slice(1);
}

describe('E2E specs actually assert outcomes (#3868)', () => {
  for (const { file, src } of specs) {
    it(`${file} has no tautological assertions or conditional no-ops`, () => {
      expect(src).not.toMatch(/expect\(true\)\.(toBeTruthy|toBe)\(/);
      for (const body of testsIn(src)) {
        expect(body, `${file} has a test with no expect()`).toContain('expect(');
      }
    });
  }

  it('contacts and deals assert the control exists before clicking', () => {
    const contacts = specs.find((s) => s.file === 'contacts.spec.ts')!.src;
    const deals = specs.find((s) => s.file === 'deals.spec.ts')!.src;
    expect(contacts).toContain('await expect(addButton).toBeVisible();');
    expect(contacts).toContain('await expect(dialog).toBeHidden();');
    expect(deals).toContain('await expect(titleInput).toBeVisible();');
    expect(deals).toContain("await expect(page.getByText('Test Deal').first()).toBeVisible();");
  });

  it('the toast test checks the rendered container', () => {
    const notifications = specs.find((s) => s.file === 'notifications.spec.ts')!.src;
    expect(notifications).toContain('await expect(toastContainer).toHaveCount(1);');
  });

  it('the runtime audit fails when it finds errors', () => {
    expect(audit).toContain('expect(errors, `runtime audit found ${errors.length} error(s)`).toEqual([])');
    expect(audit).toContain("import { test, expect } from '@playwright/test'");
  });
});
