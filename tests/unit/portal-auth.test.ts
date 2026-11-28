import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockCookieGet } = vi.hoisted(() => ({ mockCookieGet: vi.fn() }));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mockCookieGet }),
}));

// Portal-client row returned for the x-portal-token header path.
const tokenRow = {
  email: 'token-client@example.com',
  tenantId: 'tenant-token',
};

// Portal-client row returned for the cookie-session path (via getPortalSession).
const sessionRow = {
  id: 'client-1',
  tenantId: 'tenant-cookie',
  email: 'cookie-client@example.com',
  name: 'Cookie Client',
  accessToken: 'live-token',
  isActive: true,
  expiresAt: new Date(Date.now() + 86_400_000),
};

const lookups = vi.hoisted(() => ({
  token: [] as unknown[],
  config: [] as unknown[],
  settings: null as unknown,
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => table === lookups.settings ? lookups.config : lookups.token),
        })),
      })),
    })),
  },
}));

// getPortalSession mock: only the cookie path consults it. Import the real
// cookie encoder so the mock can validate like production does.
vi.mock('@/lib/portal-session', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/portal-session')>();
  return {
    ...orig,
    getPortalSession: vi.fn(async () => ({
      clientId: sessionRow.id,
      tenantId: sessionRow.tenantId,
      name: sessionRow.name,
      email: sessionRow.email,
    })),
  };
});

import { resolvePortalContact, resolvePortalIdentity } from '@/lib/portal-auth';
import { getPortalSession } from '@/lib/portal-session';
import { db } from '@/drizzle/db';
import { platformSettings } from '@/drizzle/schema';
import type { RlsTransaction } from '@/lib/db/rls';

lookups.settings = platformSettings;

function reqWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/public/quotes/x/accept', { headers });
}

describe('resolvePortalIdentity (#1913)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookups.token = [tokenRow];
    lookups.config = [];
  });

  it('resolves identity from a valid x-portal-token header', async () => {
    const identity = await resolvePortalIdentity(reqWithHeaders({ 'x-portal-token': 'good-token' }));
    expect(identity).toEqual({ email: 'token-client@example.com', tenantId: 'tenant-token' });
  });

  it('#4091 refuses a valid token when the portal is explicitly disabled', async () => {
    lookups.config = [{ value: { enabled: false } }];
    const identity = await resolvePortalIdentity(reqWithHeaders({ 'x-portal-token': 'good-token' }));
    expect(identity).toBeNull();
  });

  it('#4091 keeps working when the portal config has no explicit flag', async () => {
    lookups.config = [{ value: { enabled: true } }];
    const identity = await resolvePortalIdentity(reqWithHeaders({ 'x-portal-token': 'good-token' }));
    expect(identity).toEqual({ email: 'token-client@example.com', tenantId: 'tenant-token' });
  });

  it('returns null for an invalid/expired token (does NOT fall through to cookie)', async () => {
    lookups.token = [];
    const identity = await resolvePortalIdentity(reqWithHeaders({ 'x-portal-token': 'bad-token' }));
    expect(identity).toBeNull();
    expect(getPortalSession).not.toHaveBeenCalled();
  });

  it('falls back to the cookie session when no token header is sent', async () => {
    const identity = await resolvePortalIdentity(reqWithHeaders({}));
    expect(getPortalSession).toHaveBeenCalled();
    expect(identity).toEqual({ email: 'cookie-client@example.com', tenantId: 'tenant-cookie' });
  });

  it('ignores the spoofable x-portal-email header entirely', async () => {
    // No token header + cookie session mocked to null → 401 even though the
    // attacker supplies a victim email header.
    vi.mocked(getPortalSession).mockResolvedValueOnce(null);
    const identity = await resolvePortalIdentity(
      reqWithHeaders({ 'x-portal-email': 'victim@example.com' }),
    );
    expect(identity).toBeNull();
  });

  it('returns null when neither credential is present', async () => {
    vi.mocked(getPortalSession).mockResolvedValueOnce(null);
    expect(await resolvePortalIdentity(reqWithHeaders({}))).toBeNull();
  });
});

describe('resolvePortalContact (#1982)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // #2446: `tx` became a required parameter, because the `contacts` policy
  // compares tenant_id to app.current_tenant and the only place that value
  // lives is the caller's transaction. These pass the mock pool handle as the
  // transaction stand-in; the point of the signature is that a caller cannot
  // leave it out.
  it('returns the contact scoped to (email, tenantId)', async () => {
    lookups.token = [{ id: 'contact-9', tenantId: 'tenant-cookie' }];
    const contact = await resolvePortalContact(
      { email: 'cookie-client@example.com', tenantId: 'tenant-cookie' },
      db as unknown as RlsTransaction,
    );
    expect(contact).toEqual({ id: 'contact-9', tenantId: 'tenant-cookie' });
  });

  it('returns null when no contact matches the scoped lookup', async () => {
    lookups.token = [];
    const contact = await resolvePortalContact(
      { email: 'nobody@example.com', tenantId: 'tenant-cookie' },
      db as unknown as RlsTransaction,
    );
    expect(contact).toBeNull();
  });
});
