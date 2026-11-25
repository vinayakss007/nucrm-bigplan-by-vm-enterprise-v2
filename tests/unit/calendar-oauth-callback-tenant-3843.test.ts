import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CALLBACKS = [
  'app/api/tenant/calendar-sync/google/callback/route.ts',
  'app/api/tenant/calendar-sync/outlook/callback/route.ts',
];

describe('verified OAuth state carries the tenant (#3843)', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough';
  });

  it('extracts tenant, user and issue time from a signed state', async () => {
    const { signOAuthState, parseVerifiedOAuthState } = await import('@/lib/calendar-sync/state');
    const issuedAt = Date.now();
    const signed = signOAuthState(`tenant-1:user-1:${issuedAt}`);
    expect(parseVerifiedOAuthState(signed)).toEqual({ tenantId: 'tenant-1', userId: 'user-1', issuedAt });
  });

  it('rejects forged, malformed and stale states', async () => {
    const { signOAuthState, parseVerifiedOAuthState } = await import('@/lib/calendar-sync/state');
    const signed = signOAuthState(`tenant-1:user-1:${Date.now()}`);
    expect(parseVerifiedOAuthState(`${signed.slice(0, -1)}x`)).toBeNull();
    expect(parseVerifiedOAuthState(signOAuthState('garbage'))).toBeNull();
    expect(parseVerifiedOAuthState(signOAuthState(`tenant-1:user-1:${Date.now() - 20 * 60 * 1000}`))).toBeNull();
  });

  it('pins the state format used by the connect route', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/tenant/calendar-sync/route.ts'), 'utf8');
    expect(src).toContain('`${ctx.tenantId}:${ctx.userId}:${Date.now()}`');
  });
});

describe('calendar OAuth callbacks resolve the tenant from verified state (#3843)', () => {
  for (const file of CALLBACKS) {
    const src = readFileSync(join(process.cwd(), file), 'utf8');

    it(`${file} pins the whole handler with withApiRoute`, () => {
      expect(src).toContain('export const GET = withApiRoute(async (request: NextRequest) => {');
      expect(src).not.toContain('export async function GET(');
    });

    it(`${file} checks the state payload against the live session`, () => {
      expect(src).toContain('parseVerifiedOAuthState(state)');
      expect(src).toContain('statePayload.userId !== userId');
    });

    it(`${file} requires an active membership in the state's tenant`, () => {
      expect(src).toContain('withUserContext(userId');
      expect(src).toContain('eq(tenantMembers.tenantId, statePayload.tenantId)');
      expect(src).toContain("eq(tenantMembers.status, 'active')");
      expect(src).not.toMatch(/\.where\(eq\(tenantMembers\.userId, userId\)\)/);
    });

    it(`${file} writes the integration to the state-derived tenant`, () => {
      const writeIdx = src.indexOf('saveIntegrationConfig(tenantId');
      const stateIdx = src.indexOf('statePayload.tenantId');
      expect(writeIdx).toBeGreaterThanOrEqual(0);
      expect(stateIdx).toBeLessThan(writeIdx);
    });
  }
});
