/**
 * AI Provider Secrets Vault
 *
 * Per-tenant, per-provider encrypted API keys for the AI gateway.
 * Encryption: AES-256-GCM via lib/crypto.ts under ENCRYPTION_KEY.
 * Storage: ai_provider_secrets table (one row per (tenant, provider)).
 *
 * Same shape and threat model as the SSO `client_secret` storage.
 */
import { db } from '@/drizzle/db';
import { aiProviderSecrets } from '@/drizzle/schema/ai';
import { encrypt, decrypt } from '@/lib/crypto';
import { and, eq, isNull } from 'drizzle-orm';

export type AIProviderId = 'openai' | 'anthropic' | 'groq' | 'ollama';
export type KeyType = 'tenant' | 'personal' | 'system';

const VALID_PROVIDERS: AIProviderId[] = ['openai', 'anthropic', 'groq', 'ollama'];

export function isNamedProvider(provider: string): provider is AIProviderId {
  return VALID_PROVIDERS.includes(provider as AIProviderId);
}

export class SecretsVaultError extends Error {
  code: 'encryption_key_missing' | 'decrypt_failed' | 'invalid_provider' | 'not_found';
  constructor(code: SecretsVaultError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'SecretsVaultError';
  }
}

function getEncryptionKey(): string {
  const key = process.env['ENCRYPTION_KEY'];
  if (!key || key.length < 32) {
    throw new SecretsVaultError(
      'encryption_key_missing',
      'ENCRYPTION_KEY env var is required (>=32 chars). Generate one with: openssl rand -hex 32',
    );
  }
  return key;
}

function assertValidProvider(provider: string): asserts provider is AIProviderId {
  if (!VALID_PROVIDERS.includes(provider as AIProviderId)) {
    throw new SecretsVaultError('invalid_provider', `Unknown provider '${provider}'. Valid: ${VALID_PROVIDERS.join(', ')}`);
  }
}

/**
 * Store a provider key for a tenant. Replaces any existing key for the same
 * (tenant, provider). Soft-deletes any prior row to keep an audit trail.
 *
 * @param baseUrl  Optional self-hosted base URL (Ollama only). Plain text.
 */
export async function setProviderKey(
  tenantId: string,
  provider: string,
  plaintextKey: string,
  opts: { baseUrl?: string; userId?: string; keyType?: KeyType } = {},
): Promise<{ keyPrefix: string }> {
  const keyType: KeyType = opts.keyType ?? 'tenant';
  if (keyType === 'personal' && !opts.userId) {
    throw new SecretsVaultError('invalid_provider', 'userId is required for personal keyType');
  }
  const trimmed = plaintextKey.trim();
  if (provider !== 'ollama' && !trimmed) {
    throw new SecretsVaultError('invalid_provider', 'API key cannot be empty for cloud providers');
  }

  const encryptionKey = getEncryptionKey();

  // Soft-delete any existing key for this (tenant, provider, keyType)
  await db
    .update(aiProviderSecrets)
    .set({ deletedAt: new Date() })
    .where(and(
      eq(aiProviderSecrets.tenantId, tenantId),
      eq(aiProviderSecrets.provider, provider),
      eq(aiProviderSecrets.keyType, keyType),
      isNull(aiProviderSecrets.deletedAt),
    ));

  // Compute display prefix (last 4 chars of the plaintext, masked)
  const keyPrefix = trimmed ? `…${trimmed.slice(-4)}` : '';
  const encryptedKey = trimmed ? encrypt(trimmed, encryptionKey) : '';

  await db.insert(aiProviderSecrets).values({
    tenantId,
    provider,
    encryptedKey,
    keyPrefix,
    baseUrl: opts.baseUrl?.trim().slice(0, 200) ?? null,
    keyType,
    userId: opts.userId ?? null,
    createdBy: opts.userId ?? null,
    rotatedAt: new Date(),
  });

  return { keyPrefix };
}

/**
 * Decrypt and return the plaintext key for a given (tenant, provider).
 * Returns null if no key is stored. Throws on decrypt failure or missing key env.
 *
 * Caller is responsible for never logging or returning the plaintext to the
 * client — it is only meant to be passed to the upstream provider in an
 * outbound HTTP header.
 */
export async function getProviderKey(
  tenantId: string,
  provider: string,
  userId?: string,
): Promise<{ plaintext: string; baseUrl: string | null; modelOverride: string | null; keyType: KeyType } | null> {
  if (!isNamedProvider(provider)) return null;

  // If userId given, check personal key first
  if (userId) {
    const personalRow = await db.query.aiProviderSecrets.findFirst({
      where: and(
        eq(aiProviderSecrets.tenantId, tenantId),
        eq(aiProviderSecrets.provider, provider),
        eq(aiProviderSecrets.userId, userId),
        eq(aiProviderSecrets.keyType, 'personal'),
        isNull(aiProviderSecrets.deletedAt),
      ),
    });
    if (personalRow) {
      if (!personalRow.encryptedKey) {
        return { plaintext: '', baseUrl: personalRow.baseUrl ?? null, modelOverride: personalRow.modelOverride ?? null, keyType: 'personal' };
      }
      const encryptionKey = getEncryptionKey();
      try {
        const plaintext = decrypt(personalRow.encryptedKey, encryptionKey);
        return { plaintext, baseUrl: personalRow.baseUrl ?? null, modelOverride: personalRow.modelOverride ?? null, keyType: 'personal' };
      } catch (err) {
        throw new SecretsVaultError(
          'decrypt_failed',
          `Failed to decrypt ${provider} key for tenant. Has ENCRYPTION_KEY rotated? ${(err as Error).message}`,
        );
      }
    }
  }

  // Fall back to tenant key
  const row = await db.query.aiProviderSecrets.findFirst({
    where: and(
      eq(aiProviderSecrets.tenantId, tenantId),
      eq(aiProviderSecrets.provider, provider),
      isNull(aiProviderSecrets.deletedAt),
    ),
  });

  if (!row) return null;

  // Ollama can be saved with no key (the local daemon is open)
  if (!row.encryptedKey) {
    return { plaintext: '', baseUrl: row.baseUrl ?? null, modelOverride: row.modelOverride ?? null, keyType: (row.keyType as KeyType) ?? 'tenant' };
  }

  const encryptionKey = getEncryptionKey();
  try {
    const plaintext = decrypt(row.encryptedKey, encryptionKey);
    return { plaintext, baseUrl: row.baseUrl ?? null, modelOverride: row.modelOverride ?? null, keyType: (row.keyType as KeyType) ?? 'tenant' };
  } catch (err) {
    throw new SecretsVaultError(
      'decrypt_failed',
      `Failed to decrypt ${provider} key for tenant. Has ENCRYPTION_KEY rotated? ${(err as Error).message}`,
    );
  }
}

/**
 * Return whether a provider has a usable key stored, plus the masked prefix
 * for display. Never decrypts. Safe to call from public-ish API surfaces.
 */
export async function getProviderKeyMeta(
  tenantId: string,
  provider: string,
): Promise<{ present: boolean; keyPrefix: string | null; baseUrl: string | null; rotatedAt: Date | null; keyType: KeyType }> {
  assertValidProvider(provider);

  const row = await db.query.aiProviderSecrets.findFirst({
    where: and(
      eq(aiProviderSecrets.tenantId, tenantId),
      eq(aiProviderSecrets.provider, provider),
      isNull(aiProviderSecrets.deletedAt),
    ),
  });

  return {
    present: !!row && (!!row.encryptedKey || provider === 'ollama'),
    keyPrefix: row?.keyPrefix ?? null,
    baseUrl: row?.baseUrl ?? null,
    rotatedAt: row?.rotatedAt ?? null,
    keyType: (row?.keyType as KeyType) ?? 'tenant',
  };
}

/**
 * Soft-delete the stored key for a (tenant, provider).
 */
export async function deleteProviderKey(
  tenantId: string,
  provider: string,
  keyType: KeyType = 'tenant',
  userId?: string,
): Promise<void> {
  if (!['tenant', 'personal', 'system'].includes(keyType)) {
    throw new SecretsVaultError('invalid_provider', `Invalid keyType '${keyType}'`);
  }
  const conditions = [
    eq(aiProviderSecrets.tenantId, tenantId),
    eq(aiProviderSecrets.provider, provider),
    eq(aiProviderSecrets.keyType, keyType),
    isNull(aiProviderSecrets.deletedAt),
  ];
  if (keyType === 'personal' && userId) {
    conditions.push(eq(aiProviderSecrets.userId, userId));
  }
  await db
    .update(aiProviderSecrets)
    .set({ deletedAt: new Date() })
    .where(and(...conditions));
}

/**
 * Return key-presence metadata for every supported provider in one round-trip.
 * Used by /api/tenant/admin/ai-providers GET to render the admin form
 * without ever pulling ciphertext into the response.
 */
export async function listProviderKeyMeta(
  tenantId: string,
): Promise<Record<string, { present: boolean; keyPrefix: string | null; baseUrl: string | null; rotatedAt: Date | null }>> {
  const rows = await db
    .select({
      provider: aiProviderSecrets.provider,
      encryptedKey: aiProviderSecrets.encryptedKey,
      keyPrefix: aiProviderSecrets.keyPrefix,
      baseUrl: aiProviderSecrets.baseUrl,
      rotatedAt: aiProviderSecrets.rotatedAt,
    })
    .from(aiProviderSecrets)
    .where(and(
      eq(aiProviderSecrets.tenantId, tenantId),
      isNull(aiProviderSecrets.deletedAt),
    ));

  const out: Record<string, { present: boolean; keyPrefix: string | null; baseUrl: string | null; rotatedAt: Date | null }> = {};
  for (const row of rows) {
    if (!VALID_PROVIDERS.includes(row.provider as AIProviderId)) continue;
    out[row.provider] = {
      present: !!row.encryptedKey || row.provider === 'ollama',
      keyPrefix: row.keyPrefix,
      baseUrl: row.baseUrl,
      rotatedAt: row.rotatedAt,
    };
  }
  return out;
}

export async function setPersonalKey(
  tenantId: string,
  provider: string,
  plaintextKey: string,
  userId: string,
): Promise<{ keyPrefix: string }> {
  return setProviderKey(tenantId, provider, plaintextKey, { keyType: 'personal', userId });
}

export async function setSystemKey(
  tenantId: string,
  provider: string,
  plaintextKey: string,
): Promise<{ keyPrefix: string }> {
  return setProviderKey(tenantId, provider, plaintextKey, { keyType: 'system' });
}

export async function listAllKeysForTenant(
  tenantId: string,
): Promise<Array<{ provider: string; keyType: KeyType; keyPrefix: string | null; baseUrl: string | null; modelOverride: string | null; userId: string | null; rotatedAt: Date | null }>> {
  const rows = await db
    .select({
      provider: aiProviderSecrets.provider,
      keyType: aiProviderSecrets.keyType,
      keyPrefix: aiProviderSecrets.keyPrefix,
      baseUrl: aiProviderSecrets.baseUrl,
      modelOverride: aiProviderSecrets.modelOverride,
      userId: aiProviderSecrets.userId,
      rotatedAt: aiProviderSecrets.rotatedAt,
    })
    .from(aiProviderSecrets)
    .where(and(
      eq(aiProviderSecrets.tenantId, tenantId),
      isNull(aiProviderSecrets.deletedAt),
    ));

  return rows.map((r) => ({
    provider: r.provider,
    keyType: (r.keyType as KeyType) ?? 'tenant',
    keyPrefix: r.keyPrefix,
    baseUrl: r.baseUrl,
    modelOverride: r.modelOverride,
    userId: r.userId,
    rotatedAt: r.rotatedAt,
  }));
}
