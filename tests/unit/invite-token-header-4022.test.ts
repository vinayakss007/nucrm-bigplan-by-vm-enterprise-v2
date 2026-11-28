import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiFetcher } from '@/lib/query/client';

const ROOT = join(import.meta.dirname!, '../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('invite token transport (#4022)', () => {
  const fetchMock = vi.fn();

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('sends explicit headers with the fetch request', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: 'ok' }) });
    vi.stubGlobal('fetch', fetchMock);
    await apiFetcher('/api/auth/invite-details', { 'x-invite-token': 'secret-token' });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/invite-details', {
      headers: { 'x-invite-token': 'secret-token' },
    });
  });

  it('keeps the no-header path unchanged for all other callers', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: 'ok' }) });
    vi.stubGlobal('fetch', fetchMock);
    await apiFetcher('/api/tenant/contacts');
    expect(fetchMock).toHaveBeenCalledWith('/api/tenant/contacts', undefined);
  });

  it('the invite page no longer puts the token in the API URL', () => {
    const page = read('app/auth/invite/page.tsx');
    expect(page).not.toContain('/api/auth/invite-details?token=');
    expect(page).toContain("'/api/auth/invite-details'");
    expect(page).toContain("'x-invite-token': token");
  });

  it('the route accepts the header and keeps the query fallback plus rate limit', () => {
    const route = read('app/api/auth/invite-details/route.ts');
    const headerUse = route.indexOf("request.headers.get('x-invite-token')");
    const queryUse = route.indexOf("searchParams.get('token')");
    expect(headerUse).toBeGreaterThan(-1);
    expect(headerUse).toBeLessThan(queryUse);
    expect(route).toContain("action: 'invite-details'");
  });
});
