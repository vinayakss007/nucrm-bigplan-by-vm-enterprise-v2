import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';

// Mock drizzle DB before importing the module
vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => []),
        })),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => []),
            offset: vi.fn(() => []),
          })),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [{ id: 'new-user-id' }]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  users: { id: 'id', email: 'email', fullName: 'full_name', createdAt: 'created_at', updatedAt: 'updated_at' },
  tenantMembers: { id: 'id', tenantId: 'tenant_id', userId: 'user_id', status: 'status', roleId: 'role_id', roleSlug: 'role_slug' },
  roles: { id: 'id', tenantId: 'tenant_id', slug: 'slug' },
  sessions: { userId: 'user_id', tokenHash: 'token_hash' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  ilike: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
}));

describe('SCIM 2.0 Protocol Handler', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env['SCIM_SECRET'];
  });

  describe('parseSCIMFilter', () => {
    it('should parse a simple userName eq filter', async () => {
      const { parseSCIMFilter } = await import('@/lib/scim');
      const result = parseSCIMFilter('userName eq "user@test.com"');
      expect(result).toEqual({
        attribute: 'username',
        operator: 'eq',
        value: 'user@test.com',
      });
    });

    it('should parse a displayName co filter', async () => {
      const { parseSCIMFilter } = await import('@/lib/scim');
      const result = parseSCIMFilter('displayName co "John"');
      expect(result).toEqual({
        attribute: 'displayname',
        operator: 'co',
        value: 'John',
      });
    });

    it('should parse a filter with sw operator', async () => {
      const { parseSCIMFilter } = await import('@/lib/scim');
      const result = parseSCIMFilter('userName sw "admin"');
      expect(result).toEqual({
        attribute: 'username',
        operator: 'sw',
        value: 'admin',
      });
    });

    it('should parse active eq filter', async () => {
      const { parseSCIMFilter } = await import('@/lib/scim');
      const result = parseSCIMFilter('active eq "true"');
      expect(result).toEqual({
        attribute: 'active',
        operator: 'eq',
        value: 'true',
      });
    });

    it('should parse emails.value eq filter', async () => {
      const { parseSCIMFilter } = await import('@/lib/scim');
      const result = parseSCIMFilter('emails.value eq "test@example.com"');
      expect(result).toEqual({
        attribute: 'emails.value',
        operator: 'eq',
        value: 'test@example.com',
      });
    });

    it('should return null for empty filter', async () => {
      const { parseSCIMFilter } = await import('@/lib/scim');
      expect(parseSCIMFilter('')).toBeNull();
      expect(parseSCIMFilter(null as unknown as string)).toBeNull();
    });

    it('should return null for invalid filter syntax', async () => {
      const { parseSCIMFilter } = await import('@/lib/scim');
      expect(parseSCIMFilter('invalid filter expression!')).toBeNull();
      expect(parseSCIMFilter('username')).toBeNull();
    });
  });

  describe('toSCIMUser', () => {
    it('should convert an internal user to SCIM format', async () => {
      const { toSCIMUser } = await import('@/lib/scim');
      const user = {
        id: 'user-123',
        email: 'john@example.com',
        fullName: 'John Doe',
        active: true,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-02T00:00:00Z'),
      };

      const scimUser = toSCIMUser(user);

      expect(scimUser.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(scimUser.id).toBe('user-123');
      expect(scimUser.userName).toBe('john@example.com');
      expect(scimUser.name?.givenName).toBe('John');
      expect(scimUser.name?.familyName).toBe('Doe');
      expect(scimUser.name?.formatted).toBe('John Doe');
      expect(scimUser.displayName).toBe('John Doe');
      expect(scimUser.emails).toHaveLength(1);
      expect(scimUser.emails?.[0]?.value).toBe('john@example.com');
      expect(scimUser.emails?.[0]?.primary).toBe(true);
      expect(scimUser.active).toBe(true);
      expect(scimUser.meta?.resourceType).toBe('User');
      expect(scimUser.meta?.created).toBe('2024-01-01T00:00:00.000Z');
      expect(scimUser.meta?.lastModified).toBe('2024-01-02T00:00:00.000Z');
    });

    it('should handle user with firstName and lastName', async () => {
      const { toSCIMUser } = await import('@/lib/scim');
      const user = {
        id: 'user-456',
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Smith',
        active: true,
      };

      const scimUser = toSCIMUser(user);

      expect(scimUser.name?.givenName).toBe('Jane');
      expect(scimUser.name?.familyName).toBe('Smith');
      expect(scimUser.displayName).toBe('Jane Smith');
    });

    it('should handle inactive user', async () => {
      const { toSCIMUser } = await import('@/lib/scim');
      const user = {
        id: 'user-789',
        email: 'inactive@example.com',
        active: false,
      };

      const scimUser = toSCIMUser(user);

      expect(scimUser.active).toBe(false);
    });

    it('should include location in meta when baseUrl is provided', async () => {
      const { toSCIMUser } = await import('@/lib/scim');
      const user = {
        id: 'user-loc',
        email: 'loc@example.com',
        active: true,
      };

      const scimUser = toSCIMUser(user, 'https://app.example.com/api');
      expect(scimUser.meta?.location).toBe('https://app.example.com/api/scim/v2/Users/user-loc');
    });

    it('should handle user with no fullName', async () => {
      const { toSCIMUser } = await import('@/lib/scim');
      const user = {
        id: 'user-no-name',
        email: 'noname@example.com',
        fullName: null,
        active: true,
      };

      const scimUser = toSCIMUser(user);

      expect(scimUser.name?.givenName).toBe('');
      expect(scimUser.name?.familyName).toBe('');
      expect(scimUser.userName).toBe('noname@example.com');
    });
  });

  describe('fromSCIMUser', () => {
    it('should convert a SCIM user to internal format', async () => {
      const { fromSCIMUser } = await import('@/lib/scim');
      const scimUser = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        id: 'user-abc',
        userName: 'alice@example.com',
        name: {
          formatted: 'Alice Wonderland',
          givenName: 'Alice',
          familyName: 'Wonderland',
        },
        displayName: 'Alice Wonderland',
        emails: [
          { value: 'alice@example.com', type: 'work', primary: true },
        ],
        active: true,
      };

      const result = fromSCIMUser(scimUser);

      expect(result.email).toBe('alice@example.com');
      expect(result.fullName).toBe('Alice Wonderland');
      expect(result.firstName).toBe('Alice');
      expect(result.lastName).toBe('Wonderland');
      expect(result.active).toBe(true);
      expect(result.id).toBe('user-abc');
    });

    it('should use primary email from emails array', async () => {
      const { fromSCIMUser } = await import('@/lib/scim');
      const scimUser = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'secondary@example.com',
        emails: [
          { value: 'secondary@example.com', type: 'home', primary: false },
          { value: 'primary@example.com', type: 'work', primary: true },
        ],
        active: true,
      };

      const result = fromSCIMUser(scimUser);
      expect(result.email).toBe('primary@example.com');
    });

    it('should fall back to userName when no emails are present', async () => {
      const { fromSCIMUser } = await import('@/lib/scim');
      const scimUser = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'fallback@example.com',
        active: true,
      };

      const result = fromSCIMUser(scimUser);
      expect(result.email).toBe('fallback@example.com');
    });

    it('should construct fullName from displayName when name is missing', async () => {
      const { fromSCIMUser } = await import('@/lib/scim');
      const scimUser = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'bob@example.com',
        displayName: 'Bob Builder',
        active: true,
      };

      const result = fromSCIMUser(scimUser);
      expect(result.fullName).toBe('Bob Builder');
    });

    it('should handle inactive users', async () => {
      const { fromSCIMUser } = await import('@/lib/scim');
      const scimUser = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'deactivated@example.com',
        active: false,
      };

      const result = fromSCIMUser(scimUser);
      expect(result.active).toBe(false);
    });

    it('should build fullName from givenName and familyName when formatted is absent', async () => {
      const { fromSCIMUser } = await import('@/lib/scim');
      const scimUser = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'parts@example.com',
        name: {
          givenName: 'First',
          familyName: 'Last',
        },
        active: true,
      };

      const result = fromSCIMUser(scimUser);
      expect(result.fullName).toBe('First Last');
      expect(result.firstName).toBe('First');
      expect(result.lastName).toBe('Last');
    });
  });

  describe('generateSCIMResponse', () => {
    it('should generate a valid ListResponse', async () => {
      const { generateSCIMResponse, toSCIMUser } = await import('@/lib/scim');
      const users = [
        toSCIMUser({ id: '1', email: 'a@b.com', active: true }),
        toSCIMUser({ id: '2', email: 'c@d.com', active: true }),
      ];

      const response = generateSCIMResponse(users, 10, 1);

      expect(response.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(response.totalResults).toBe(10);
      expect(response.startIndex).toBe(1);
      expect(response.itemsPerPage).toBe(2);
      expect(response.Resources).toHaveLength(2);
    });

    it('should handle empty results', async () => {
      const { generateSCIMResponse } = await import('@/lib/scim');
      const response = generateSCIMResponse([], 0, 1);

      expect(response.totalResults).toBe(0);
      expect(response.itemsPerPage).toBe(0);
      expect(response.Resources).toHaveLength(0);
    });

    it('should respect startIndex for pagination', async () => {
      const { generateSCIMResponse, toSCIMUser } = await import('@/lib/scim');
      const users = [
        toSCIMUser({ id: '3', email: 'e@f.com', active: true }),
      ];

      const response = generateSCIMResponse(users, 50, 11);

      expect(response.startIndex).toBe(11);
      expect(response.totalResults).toBe(50);
      expect(response.itemsPerPage).toBe(1);
    });
  });

  describe('verifySCIMToken', () => {
    it('should return null when no SCIM_SECRET is configured', async () => {
      delete process.env['SCIM_SECRET'];
      const { verifySCIMToken } = await import('@/lib/scim');
      const result = await verifySCIMToken('sometoken', 'tenant-1');
      expect(result).toBeNull();
    });

    it('should verify a v1 token (deprecated format)', async () => {
      process.env['SCIM_SECRET'] = 'test-secret-key';
      const { verifySCIMToken } = await import('@/lib/scim');

      const tenantId = 'tenant-123';
      const expectedToken = createHmac('sha256', 'test-secret-key')
        .update(tenantId)
        .digest('hex');

      const result = await verifySCIMToken(expectedToken, tenantId);
      expect(result).toEqual({ tenantId });
    });

    it('should verify a v2 token with embedded tenant', async () => {
      process.env['SCIM_SECRET'] = 'test-secret-key';
      const { createSCIMToken, verifySCIMToken } = await import('@/lib/scim');

      const token = createSCIMToken('tenant-v2', 3600);
      expect(token).toBeTruthy();

      const result = await verifySCIMToken(token!, 'ignored');
      expect(result).toEqual({ tenantId: 'tenant-v2' });
    });

    it('should reject an expired v2 token', async () => {
      process.env['SCIM_SECRET'] = 'test-secret-key';
      const { verifySCIMToken } = await import('@/lib/scim');

      const tenantId = 'tenant-expired';
      const expiryMs = Date.now() - 1000; // already expired
      const hmac = createHmac('sha256', 'test-secret-key')
        .update(`${tenantId}:${expiryMs}`)
        .digest('hex');
      const expiredToken = `${tenantId}:${expiryMs}:${hmac}`;

      const result = await verifySCIMToken(expiredToken, '');
      expect(result).toBeNull();
    });

    it('should reject an invalid token', async () => {
      process.env['SCIM_SECRET'] = 'test-secret-key';
      const { verifySCIMToken } = await import('@/lib/scim');
      const result = await verifySCIMToken('invalid-token', 'tenant-123');
      expect(result).toBeNull();
    });

    it('should reject empty token', async () => {
      process.env['SCIM_SECRET'] = 'test-secret-key';
      const { verifySCIMToken } = await import('@/lib/scim');
      expect(await verifySCIMToken('', 'tenant-1')).toBeNull();
    });

    it('should reject v1 token for wrong tenant', async () => {
      process.env['SCIM_SECRET'] = 'test-secret-key';
      const { verifySCIMToken } = await import('@/lib/scim');

      const token = createHmac('sha256', 'test-secret-key')
        .update('tenant-A')
        .digest('hex');

      const result = await verifySCIMToken(token, 'tenant-B');
      expect(result).toBeNull();
    });
  });

  describe('generateSCIMError', () => {
    it('should generate a proper error response body', async () => {
      const { generateSCIMError } = await import('@/lib/scim');
      const error = generateSCIMError('Not found', 404);

      expect(error.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(error.detail).toBe('Not found');
      expect(error.status).toBe('404');
    });
  });

  describe('SCIM user roundtrip', () => {
    it('should preserve data through toSCIMUser -> fromSCIMUser conversion', async () => {
      const { toSCIMUser, fromSCIMUser } = await import('@/lib/scim');

      const original = {
        id: 'roundtrip-1',
        email: 'roundtrip@example.com',
        fullName: 'Round Trip',
        active: true,
        createdAt: new Date('2024-06-01'),
        updatedAt: new Date('2024-06-02'),
      };

      const scim = toSCIMUser(original);
      const back = fromSCIMUser(scim);

      expect(back.email).toBe(original.email);
      expect(back.fullName).toBe(original.fullName);
      expect(back.active).toBe(true);
      expect(back.id).toBe(original.id);
    });
  });
});
