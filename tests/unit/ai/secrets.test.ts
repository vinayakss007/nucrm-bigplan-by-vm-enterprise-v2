import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbFindFirst = vi.fn(() => Promise.resolve(null));
const mockDbSelectResolve = vi.fn(() => Promise.resolve([]));

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      aiProviderSecrets: {
        findFirst: vi.fn(() => mockDbFindFirst()),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => mockDbSelectResolve()),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve()),
    })),
  },
}));

vi.mock('@/lib/crypto', () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  decrypt: vi.fn((v: string) => v.replace('enc:', '')),
}));

vi.mock('@/drizzle/schema/ai', () => ({
  aiProviderSecrets: {
    id: 'id', tenantId: 'tenant_id', provider: 'provider',
    encryptedKey: 'encrypted_key', keyPrefix: 'key_prefix',
    baseUrl: 'base_url', createdAt: 'created_at', createdBy: 'created_by', rotatedAt: 'rotated_at',
    deletedAt: 'deleted_at', keyType: 'key_type', userId: 'user_id',
    modelOverride: 'model_override', updatedAt: 'updated_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...a: unknown[]) => ({ type: 'eq', args: a })),
  and: vi.fn((...a: unknown[]) => ({ type: 'and', args: a })),
  isNull: vi.fn((...a: unknown[]) => ({ type: 'isNull', args: a })),
  sql: Object.assign(vi.fn(() => ({ type: 'sql' })), { raw: vi.fn() }),
}));

const ORIGINAL_ENV = process.env;

describe('AI Secrets Vault', () => {
  let mod: typeof import('@/lib/ai/secrets');

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbFindFirst.mockReset();
    mockDbFindFirst.mockReturnValue(Promise.resolve(null));
    mockDbSelectResolve.mockReset();
    mockDbSelectResolve.mockReturnValue(Promise.resolve([]));
    process.env = { ...ORIGINAL_ENV, ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef' };
    mod = await import('@/lib/ai/secrets');
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('SecretsVaultError', () => {
    it('creates error with code and message', () => {
      const err = new mod.SecretsVaultError('encryption_key_missing', 'Key missing');
      expect(err.code).toBe('encryption_key_missing');
      expect(err.name).toBe('SecretsVaultError');
    });
  });

  describe('setProviderKey', () => {
    it('stores an encrypted key for tenant keyType by default', async () => {
      const result = await mod.setProviderKey('tenant-1', 'openai', 'sk-test-key-1234');
      expect(result.keyPrefix).toBe('…1234');
    });

    it('accepts any provider (provider-agnostic)', async () => {
      const result = await mod.setProviderKey('t-1', 'invalid', 'key');
      expect(result.keyPrefix).toBeDefined();
    });

    it('throws for empty key on cloud providers', async () => {
      await expect(mod.setProviderKey('t-1', 'openai', '  ')).rejects.toThrow(mod.SecretsVaultError);
    });

    it('allows empty key for ollama', async () => {
      const result = await mod.setProviderKey('tenant-1', 'ollama', '');
      expect(result.keyPrefix).toBe('');
    });

    it('throws when ENCRYPTION_KEY is missing', async () => {
      process.env = { ...ORIGINAL_ENV };
      delete process.env.ENCRYPTION_KEY;
      await expect(mod.setProviderKey('t-1', 'openai', 'key')).rejects.toThrow('ENCRYPTION_KEY');
    });

    it('throws when ENCRYPTION_KEY is too short', async () => {
      process.env = { ...ORIGINAL_ENV, ENCRYPTION_KEY: 'short' };
      await expect(mod.setProviderKey('t-1', 'openai', 'key')).rejects.toThrow('ENCRYPTION_KEY');
    });

    it('accepts baseUrl and userId options', async () => {
      await mod.setProviderKey('t-1', 'ollama', '', { baseUrl: 'http://ollama:11434', userId: 'u-1' });
    });

    it('accepts keyType option', async () => {
      const result = await mod.setProviderKey('t-1', 'openai', 'sk-test', { keyType: 'system' });
      expect(result.keyPrefix).toBe('…test');
    });

    it('requires userId for personal keyType', async () => {
      await expect(mod.setProviderKey('t-1', 'openai', 'key', { keyType: 'personal' })).rejects.toThrow(mod.SecretsVaultError);
    });
  });

  describe('getProviderKey', () => {
    it('returns decrypted tenant key when no userId given', async () => {
      mockDbFindFirst.mockResolvedValueOnce({ encryptedKey: 'enc:sk-real', baseUrl: null, keyType: 'tenant', modelOverride: null });
      const result = await mod.getProviderKey('t-1', 'openai');
      expect(result).toEqual({ plaintext: 'sk-real', baseUrl: null, modelOverride: null, keyType: 'tenant' });
    });

    it('returns null when no key exists', async () => {
      mockDbFindFirst.mockResolvedValueOnce(null); // tenant
      mockDbFindFirst.mockResolvedValueOnce(null); // system
      expect(await mod.getProviderKey('t-1', 'openai')).toBeNull();
    });

    it('returns personal key if present', async () => {
      mockDbFindFirst.mockResolvedValueOnce({ encryptedKey: 'enc:personal-key', baseUrl: null, modelOverride: null });
      const result = await mod.getProviderKey('t-1', 'openai', 'u-1');
      expect(result).toEqual({ plaintext: 'personal-key', baseUrl: null, modelOverride: null, keyType: 'personal' });
    });

    it('returns empty for ollama with no encrypted key', async () => {
      mockDbFindFirst.mockResolvedValueOnce({ encryptedKey: '', baseUrl: 'http://localhost:11434', keyType: 'tenant', modelOverride: null });
      const result = await mod.getProviderKey('t-1', 'ollama');
      expect(result.plaintext).toBe('');
      expect(result.baseUrl).toBe('http://localhost:11434');
    });

    it('throws SecretsVaultError on decrypt failure', async () => {
      mockDbFindFirst.mockResolvedValueOnce({ encryptedKey: 'enc:bad', baseUrl: null, modelOverride: null });
      vi.mocked((await import('@/lib/crypto')).decrypt).mockImplementationOnce(() => { throw new Error('bad'); });
      await expect(mod.getProviderKey('t-1', 'openai')).rejects.toThrow(mod.SecretsVaultError);
    });

    it('returns null for unknown provider', async () => {
      mockDbFindFirst.mockResolvedValueOnce(null);
      mockDbFindFirst.mockResolvedValueOnce(null);
      const result = await mod.getProviderKey('t-1', 'invalid');
      expect(result).toBeNull();
    });
  });

  describe('getProviderKeyMeta', () => {
    it('returns tenant key info when no userId given', async () => {
      mockDbFindFirst.mockResolvedValueOnce({ encryptedKey: 'enc:v', keyPrefix: '…abcd', baseUrl: null, modelOverride: null, rotatedAt: new Date('2026-01-01') });
      const r = await mod.getProviderKeyMeta('t-1', 'openai');
      expect(r.present).toBe(true);
      expect(r.keyPrefix).toBe('…abcd');
      expect(r.keyType).toBe('tenant');
    });

    it('returns present=false when no key', async () => {
      mockDbFindFirst.mockResolvedValueOnce(null); // tenant
      mockDbFindFirst.mockResolvedValueOnce(null); // system
      const r = await mod.getProviderKeyMeta('t-1', 'openai');
      expect(r.present).toBe(false);
    });

    it('ollama is present without encrypted key', async () => {
      mockDbFindFirst.mockResolvedValueOnce({ encryptedKey: '', keyPrefix: '', baseUrl: 'http://localhost:11434', modelOverride: null, rotatedAt: new Date() });
      const r = await mod.getProviderKeyMeta('t-1', 'ollama');
      expect(r.present).toBe(true);
    });
  });

  describe('deleteProviderKey', () => {
    it('soft deletes the key with default keyType', async () => {
      await expect(mod.deleteProviderKey('t-1', 'openai')).resolves.not.toThrow();
    });

    it('deletes with keyType param', async () => {
      await expect(mod.deleteProviderKey('t-1', 'openai', 'system')).resolves.not.toThrow();
    });

    it('deletes with keyType and userId', async () => {
      await expect(mod.deleteProviderKey('t-1', 'openai', 'personal', 'u-1')).resolves.not.toThrow();
    });

    it('throws for invalid keyType', async () => {
      await expect(mod.deleteProviderKey('t-1', 'openai', 'invalid' as never)).rejects.toThrow(mod.SecretsVaultError);
    });

    it('accepts any provider (provider-agnostic)', async () => {
      await expect(mod.deleteProviderKey('t-1', 'invalid')).resolves.not.toThrow();
    });
  });

  describe('listAllKeysForTenant', () => {
    it('returns array of key rows', async () => {
      mockDbSelectResolve.mockResolvedValueOnce([
        { provider: 'openai', keyType: 'system', keyPrefix: '…a', baseUrl: null, modelOverride: null, userId: null, rotatedAt: null },
        { provider: 'anthropic', keyType: 'tenant', keyPrefix: '…b', baseUrl: null, modelOverride: null, userId: null, rotatedAt: new Date() },
      ]);
      const result = await mod.listAllKeysForTenant('t-1');
      expect(result).toHaveLength(2);
      expect(result[0].provider).toBe('openai');
      expect(result[0].keyType).toBe('system');
    });

    it('returns empty array when no keys', async () => {
      mockDbSelectResolve.mockResolvedValueOnce([]);
      const result = await mod.listAllKeysForTenant('t-1');
      expect(result).toEqual([]);
    });
  });

  describe('setPersonalKey', () => {
    it('stores a personal key', async () => {
      const result = await mod.setPersonalKey('t-1', 'openai', 'sk-test-5678', 'u-1');
      expect(result.keyPrefix).toBe('…5678');
    });
  });

  describe('setSystemKey', () => {
    it('stores a system key', async () => {
      const result = await mod.setSystemKey('t-1', 'openai', 'sk-test-9012');
      expect(result.keyPrefix).toBe('…9012');
    });
  });

  describe('listProviderKeyMeta', () => {
    it('returns metadata for providers that have keys (priority-based)', async () => {
      mockDbSelectResolve.mockResolvedValueOnce([
        { provider: 'openai', encryptedKey: 'enc:1', keyPrefix: '…a', baseUrl: null, modelOverride: null, rotatedAt: new Date(), keyType: 'tenant', userId: null },
        { provider: 'anthropic', encryptedKey: 'enc:2', keyPrefix: '…b', baseUrl: null, modelOverride: null, rotatedAt: new Date(), keyType: 'tenant', userId: null },
      ]);
      const result = await mod.listProviderKeyMeta('t-1');
      expect(result.openai.present).toBe(true);
      expect(result.anthropic.present).toBe(true);
    });

    it('returns empty object when no keys exist', async () => {
      mockDbSelectResolve.mockResolvedValueOnce([]);
      const result = await mod.listProviderKeyMeta('t-1');
      expect(Object.keys(result)).toHaveLength(0);
    });
  });

  describe('isNamedProvider', () => {
    it('returns true for known providers', () => {
      expect(mod.isNamedProvider('openai')).toBe(true);
      expect(mod.isNamedProvider('ollama')).toBe(true);
    });

    it('returns false for unknown providers', () => {
      expect(mod.isNamedProvider('invalid')).toBe(false);
    });
  });
});
