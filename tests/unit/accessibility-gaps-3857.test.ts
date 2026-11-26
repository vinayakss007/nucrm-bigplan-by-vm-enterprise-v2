import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');

describe('concrete accessibility gaps are closed (#3857)', () => {
  it('names every previously unlabelled icon-only button', () => {
    const cases: Array<[string, string]> = [
      ['components/shared/pwa-install-prompt.tsx', 'aria-label="Dismiss install prompt"'],
      ['components/ui/bulk-action-bar.tsx', 'aria-label="Clear selection"'],
      ['components/tenant/email-verify-banner.tsx', 'aria-label="Dismiss verification reminder"'],
      ['app/tenant/email-templates/page.tsx', 'aria-label="Close template editor"'],
      ['app/superadmin/tenants/[id]/roles/page.tsx', 'aria-label="Close role editor"'],
    ];
    for (const [file, attribute] of cases) expect(read(file), file).toContain(attribute);
  });

  it('associates portal form labels with their controls', () => {
    const login = read('app/portal/login/page.tsx');
    const tickets = read('app/portal/(protected)/tickets/page.tsx');
    for (const id of ['portal-email', 'portal-token', 'portal-tenant']) {
      expect(login).toContain(`htmlFor="${id}"`);
      expect(login).toContain(`id="${id}"`);
    }
    for (const id of ['ticket-email', 'ticket-subject', 'ticket-category', 'ticket-description']) {
      expect(tickets).toContain(`htmlFor="${id}"`);
      expect(tickets).toContain(`id="${id}"`);
    }
  });

  it('exposes disclosure state and makes clickable rows keyboard operable', () => {
    expect(read('app/portal/(protected)/quotes/page.tsx')).toContain('aria-expanded={isExpanded}');
    for (const file of ['app/tenant/tickets/page.tsx', 'app/superadmin/tickets/page.tsx']) {
      const src = read(file);
      expect(src, file).toContain('role="button"');
      expect(src, file).toContain('tabIndex={0}');
      expect(src, file).toContain("e.key === 'Enter'");
      expect(src, file).toContain("e.key === ' '");
    }
  });
});
