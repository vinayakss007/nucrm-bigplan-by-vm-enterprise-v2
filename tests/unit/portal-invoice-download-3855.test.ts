import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(process.cwd(), 'app/portal/(protected)/invoices/page.tsx'), 'utf8');
const route = readFileSync(join(process.cwd(), 'app/api/public/invoices/[id]/pdf/route.ts'), 'utf8');

describe('portal invoice download is real and named (#3855)', () => {
  it('renders a link to the PDF endpoint instead of a no-op button', () => {
    expect(page).toContain('href={`/api/public/invoices/${inv.id}/pdf`}');
    expect(page).not.toMatch(/<button[^>]*>\s*<Download/);
  });

  it('gives the icon-only control an accessible name', () => {
    expect(page).toContain('aria-label={`Download invoice ${inv.invoiceNumber} as PDF`}');
    expect(page).toContain('title={`Download invoice ${inv.invoiceNumber} as PDF`}');
  });

  it('rates-limits and authenticates the portal caller', () => {
    expect(route).toContain("action: 'public-invoice-pdf'");
    expect(route).toContain('resolvePortalIdentity(request)');
    expect(route).toContain('withTenantContext(identity.tenantId, NO_USER_SENTINEL');
  });

  it('scopes the invoice to the caller contact and visible statuses', () => {
    expect(route).toContain('eq(invoices.contactId, contact.id)');
    expect(route).toContain('eq(invoices.tenantId, contact.tenantId)');
    expect(route).toContain('inArray(invoices.status, VISIBLE_STATUSES)');
    expect(route).toContain("eq(invoiceLineItems.invoiceId, invoiceId)");
  });

  it('returns a downloadable PDF with a sanitized filename', () => {
    expect(route).toContain('renderInvoicePdf(');
    expect(route).toContain("'Content-Disposition': `attachment; filename=\"${safeName}.pdf\"`");
    expect(route).toContain("'Content-Type': 'application/pdf'");
  });
});
