/**
 * #3773 — the client/server payload-contract ratchet. These tests pin the
 * detector's shape (not the live ledger): a new read that no route declares is
 * a finding, a shrink is progress, and a stale ledger entry fails.
 */
import { describe, it, expect } from 'vitest';
import {
  responseKeys,
  routeForUrl,
  collectQueryVars,
  apiUrls,
  readKeys,
  checkContractShape,
} from '../../scripts/check-contract-shape.mjs';

const ROUTES = ['app/api/tenant/contacts/route.ts', 'app/api/tenant/tickets/[id]/route.ts'];

describe('contract-shape detection (#3773)', () => {
  it('extracts top-level response keys, ignoring nested shapes', () => {
    const src = `NextResponse.json({ data: rows, total: 1, meta: { nested: 'x' } })`;
    const keys = responseKeys(src);
    expect([...keys].sort()).toEqual(['data', 'meta', 'total']);
  });

  it('resolves API URLs to route files, including dynamic segments', () => {
    expect(routeForUrl('/api/tenant/contacts?limit=20', ROUTES)).toBe('app/api/tenant/contacts/route.ts');
    expect(routeForUrl('/api/tenant/tickets/tkt-1', ROUTES)).toBe('app/api/tenant/tickets/[id]/route.ts');
    expect(routeForUrl('/api/tenant/unknown', ROUTES)).toBeNull();
  });

  it('finds useApiQuery data variables and the URLs they read', () => {
    const src = `
      const { data: contactsData, error } = useApiQuery<{ data: unknown[] }>(KEY, '/api/tenant/contacts');
      const result = useApiQuery(KEY2, '/api/tenant/tickets');
    `;
    expect([...collectQueryVars(src)].sort()).toEqual(['contactsData', 'result.data']);
    expect([...apiUrls(src)].sort()).toEqual(['/api/tenant/contacts', '/api/tenant/tickets']);
  });

  it('reads only property accesses on the query result variables', () => {
    expect([...readKeys('contactsData?.contacts; contactsData.total; other.blah', new Set(['contactsData']))])
      .toEqual(['contacts', 'total']);
  });
});

describe('checkContractShape ledger (#3773)', () => {
  const files = ['app/tenant/invoices/page.tsx'];
  const src = 'const { data: contactsData } = useApiQuery(K, "/api/tenant/contacts"); contactsData?.contacts;';
  const readFile = (_path: string) => src;

  it('passes when the finding matches the pinned ledger', () => {
    expect(checkContractShape(files, readFile, { 'app/tenant/invoices/page.tsx': ['contacts'] }, ROUTES)).toEqual([]);
  });

  it('fails on a new finding not in the ledger', () => {
    const problems = checkContractShape(files, readFile, {}, ROUTES);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/reads contacts with no matching response key/);
  });

  it('fails on a changed finding — the surface may only shrink', () => {
    const problems = checkContractShape(files, readFile, { 'app/tenant/invoices/page.tsx': ['oldKey'] }, ROUTES);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/contract reads changed/);
  });

  it('fails on a stale entry after a mismatch is fixed', () => {
    const emptySrc = 'const { data: contactsData } = useApiQuery(K, "/api/tenant/contacts"); contactsData?.data;';
    const problems = checkContractShape(files, () => emptySrc, { 'app/tenant/invoices/page.tsx': ['contacts'] }, ROUTES);
    expect(problems[0]).toMatch(/no longer has contract findings/);
  });
});
