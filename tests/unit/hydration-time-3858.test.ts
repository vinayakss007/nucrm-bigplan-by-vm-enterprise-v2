import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILES = [
  'app/portal/(protected)/quotes/page.tsx',
  'app/superadmin/tenants/page.tsx',
  'components/tenant/dashboard/widget-wrapper.tsx',
  'app/tenant/offers/page.tsx',
  'app/tenant/approvals/page.tsx',
  'app/tenant/ai/activity/page.tsx',
  'app/tenant/settings/backup/page.tsx',
  'app/tenant/settings/email/warmup/page.tsx',
  'app/superadmin/backups/page.tsx',
];

describe('time-dependent UI waits for hydration (#3858)', () => {
  it('uses the shared hook in every affected component', () => {
    for (const file of FILES) {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      expect(src, `${file} must use useHydratedNow`).toContain("from '@/hooks/use-hydrated-now'");
      expect(src, `${file} must call useHydratedNow`).toContain('useHydratedNow()');
    }
  });

  it('has no Date.now() left in the render path of those files', () => {
    for (const file of FILES) {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      if (file.endsWith('superadmin/tenants/page.tsx')) {
        expect(src.match(/Date\.now\(\)/g)).toHaveLength(2);
        expect(src.indexOf('Date.now()')).toBeGreaterThan(src.indexOf('const executeExtendTrial'));
      } else {
        expect(src, `${file} still reads Date.now()`).not.toContain('Date.now()');
      }
    }
  });

  it('the hook returns null until the effect runs', () => {
    const src = readFileSync(join(process.cwd(), 'hooks/use-hydrated-now.ts'), 'utf8');
    expect(src).toContain("useState<number | null>(null)");
    expect(src).toContain('useEffect(() => {\n    setNow(Date.now());\n  }, [])');
    expect(src).toContain('return now;');
  });
});
