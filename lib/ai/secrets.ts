/**
 * AI Provider Secrets Vault
 *
 * Per-tenant, per-provider encrypted API keys for the AI gateway.
 * Encryption: AES-256-GCM via lib/crypto.ts under ENCRYPTION_KEY.
 * Storage: ai_provider_secrets table (one row per (tenant, provider, keyType)).
 *
 * Key resolution order: personal → tenant → system (first found wins).
 *
 * Same shape and threat model as the SSO `client_secret` storage.
 */
import { db } from '@/drizzle/db';
import { aiProviderSecrets } from '@/drizzle/schema/ai';
import { encrypt, decrypt } from '@/lib/crypto';
import { and, eq, isNull } from 'drizzle-orm';

/** Named providers have presets; any other string is a custom OpenAI-compatible provider. */
export type NamedProvider = 'openai' | 'anthropic' | 'groq' | 'ollama' | 'opencode';
export type AIProviderId = string;
export type KeyType = 'system' | 'tenant' | 'personal';

/** Providers with built-in presets (defaults, special API handling). */
const NAMED_PROVIDERS: NamedProvider[] = ['openai', 'anthropic', 'groq', 'ollama', 'opencode'];

export class SecretsVaultError extends Error {
  code: 'encryption_key_missing' | 'decrypt_failed' | 'invalid_key_type' | 'not_found';
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

function assertValidKeyType(keyType: string): asserts keyType is KeyType {
  if (!['system', 'tenant', 'personal'].includes(keyType)) {
    throw new SecretsVaultError('invalid_key_type', `Invalid keyType '${keyType}'. Valid: system, tenant, personal`);
  }
}

/** Check if a provider ID is a named (preset) provider. */
export function isNamedProvider(id: string): id is NamedProvider {
  return NAMED_PROVIDERS.includes(id as NamedProvider);
}

// ── Provider key resolution (personal → tenant → system) ──────────────

/**
 * Decrypt and return the plaintext key for a given (tenant, provider, userId).
 * Lookup order: personal → tenant → system (first found wins).
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

  // 1. Try personal key first
  if (userId) {
    const personal = await db.query.aiProviderSecrets.findFirst({
      where: and(
        eq(aiProviderSecrets.tenantId, tenantId),
        eq(aiProviderSecrets.provider, provider),
        eq(aiProviderSecrets.keyType, 'personal'),
        eq(aiProviderSecrets.userId, userId),
        isNull(aiProviderSecrets.deletedAt),
      ),
    });
    if (personal) {
      return decryptRow(personal, 'personal');
    }
  }

  // 2. Try tenant key
  const tenant = await db.query.aiProviderSecrets.findFirst({
    where: and(
      eq(aiProviderSecrets.tenantId, tenantId),
      eq(aiProviderSecrets.provider, provider),
      eq(aiProviderSecrets.keyType, 'tenant'),
      isNull(aiProviderSecrets.deletedAt),
    ),
  });
  if (tenant) {
    return decryptRow(tenant, 'tenant');
  }

  // 3. Try system key (platform-provided)
  const system = await db.query.aiProviderSecrets.findFirst({
    where: and(
      eq(aiProviderSecrets.tenantId, tenantId),
      eq(aiProviderSecrets.provider, provider),
      eq(aiProviderSecrets.keyType, 'system'),
      isNull(aiProviderSecrets.deletedAt),
    ),
  });
  if (system) {
    return decryptRow(system, 'system');
  }

  return null;
}

async function decryptRow(
  row: { encryptedKey: string; baseUrl: string | null; modelOverride: string | null },
  keyType: KeyType,
): Promise<{ plaintext: string; baseUrl: string | null; modelOverride: string | null; keyType: KeyType }> {
  if (!row.encryptedKey) {
    return { plaintext: '', baseUrl: row.baseUrl ?? null, modelOverride: row.modelOverride ?? null, keyType };
  }

  const encryptionKey = getEncryptionKey();
  try {
    const plaintext = decrypt(row.encryptedKey, encryptionKey);
    return { plaintext, baseUrl: row.baseUrl ?? null, modelOverride: row.modelOverride ?? null, keyType };
  } catch (err) {
    throw new SecretsVaultError(
      'decrypt_failed',
      `Failed to decrypt key for ${keyType} key. Has ENCRYPTION_KEY rotated? ${(err as Error).message}`,
    );
  }
}

// ── Store keys ────────────────────────────────────────────────────────

/**
 * Store a provider key for a tenant. Replaces any existing key for the same
 * (tenant, provider, keyType). Soft-deletes any prior row to keep an audit trail.
 *
 * @param keyType  'system' | 'tenant' | 'personal'
 * @param userId   Required for personal keys; ignored for system/tenant keys.
 * @param baseUrl  Optional self-hosted base URL (Ollama/OpenCode only). Plain text.
 */
export async function setProviderKey(
  tenantId: string,
  provider: string,
  plaintextKey: string,
  opts: { baseUrl?: string; modelOverride?: string; userId?: string; keyType?: KeyType } = {},
): Promise<{ keyPrefix: string }> {
  const keyType = opts.keyType ?? 'tenant';
  assertValidKeyType(keyType);

  if (keyType === 'personal' && !opts.userId) {
    throw new SecretsVaultError('invalid_key_type', 'userId is required for personal keys');
  }

  const trimmed = plaintextKey.trim();
  // Only cloud providers with known APIs require a key; custom/self-hosted may not
  const needsKey = !['ollama', 'opencode'].includes(provider) && !opts.baseUrl;
  if (needsKey && !trimmed) {
    throw new SecretsVaultError('invalid_key_type', 'API key cannot be empty for cloud providers');
  }

  const encryptionKey = getEncryptionKey();

  // Soft-delete any existing key for this (tenant, provider, keyType) combination
  // For personal keys, also match on userId
  const deleteConditions = [
    eq(aiProviderSecrets.tenantId, tenantId),
    eq(aiProviderSecrets.provider, provider),
    eq(aiProviderSecrets.keyType, keyType),
    isNull(aiProviderSecrets.deletedAt),
  ];
  if (keyType === 'personal' && opts.userId) {
    deleteConditions.push(eq(aiProviderSecrets.userId, opts.userId));
  }
  await db
    .update(aiProviderSecrets)
    .set({ deletedAt: new Date() })
    .where(and(...deleteConditions));

  // Compute display prefix (last 4 chars of the plaintext, masked)
  const keyPrefix = trimmed ? `…${trimmed.slice(-4)}` : '';
  const encryptedKey = trimmed ? encrypt(trimmed, encryptionKey) : '';

  await db.insert(aiProviderSecrets).values({
    tenantId,
    provider,
    keyType,
    userId: keyType === 'personal' ? (opts.userId ?? null) : null,
    encryptedKey,
    keyPrefix,
    baseUrl: opts.baseUrl?.trim().slice(0, 500) ?? null,
    modelOverride: opts.modelOverride?.trim().slice(0, 200) ?? null,
    createdBy: opts.userId ?? null,
    rotatedAt: new Date(),
  });

  return { keyPrefix };
}

/**
 * Convenience: store a system-level key (platform-provided).
 */
export async function setSystemKey(
  tenantId: string,
  provider: string,
  plaintextKey: string,
  opts: { baseUrl?: string; modelOverride?: string } = {},
): Promise<{ keyPrefix: string }> {
  return setProviderKey(tenantId, provider, plaintextKey, { ...opts, keyType: 'system' });
}

/**
 * Convenience: store a personal key for a user.
 */
export async function setPersonalKey(
  tenantId: string,
  provider: string,
  plaintextKey: string,
  userId: string,
  opts: { baseUrl?: string; modelOverride?: string } = {},
): Promise<{ keyPrefix: string }> {
  return setProviderKey(tenantId, provider, plaintextKey, { ...opts, keyType: 'personal', userId });
}

// ── Metadata queries (no decrypt) ─────────────────────────────────────

/**
 * Return whether a provider has a usable key stored, plus the masked prefix
 * for display. Never decrypts. Safe to call from public-ish API surfaces.
 * Resolves the effective key (personal → tenant → system) and returns info
 * about which key type is in use.
 */
export async function getProviderKeyMeta(
  tenantId: string,
  provider: string,
  userId?: string,
): Promise<{
  present: boolean;
  keyPrefix: string | null;
  baseUrl: string | null;
  modelOverride: string | null;
  rotatedAt: Date | null;
  keyType: KeyType | null;
}> {

  // 1. Check personal key
  if (userId) {
    const personal = await db.query.aiProviderSecrets.findFirst({
      where: and(
        eq(aiProviderSecrets.tenantId, tenantId),
        eq(aiProviderSecrets.provider, provider),
        eq(aiProviderSecrets.keyType, 'personal'),
        eq(aiProviderSecrets.userId, userId),
        isNull(aiProviderSecrets.deletedAt),
      ),
    });
    if (personal) {
      return {
        present: !!personal.encryptedKey || provider === 'ollama' || provider === 'opencode',
        keyPrefix: personal.keyPrefix,
        baseUrl: personal.baseUrl,
        modelOverride: personal.modelOverride,
        rotatedAt: personal.rotatedAt,
        keyType: 'personal',
      };
    }
  }

  // 2. Check tenant key
  const tenant = await db.query.aiProviderSecrets.findFirst({
    where: and(
      eq(aiProviderSecrets.tenantId, tenantId),
      eq(aiProviderSecrets.provider, provider),
      eq(aiProviderSecrets.keyType, 'tenant'),
      isNull(aiProviderSecrets.deletedAt),
    ),
  });
  if (tenant) {
    return {
      present: !!tenant.encryptedKey || provider === 'ollama' || provider === 'opencode',
      keyPrefix: tenant.keyPrefix,
      baseUrl: tenant.baseUrl,
      modelOverride: tenant.modelOverride,
      rotatedAt: tenant.rotatedAt,
      keyType: 'tenant',
    };
  }

  // 3. Check system key
  const system = await db.query.aiProviderSecrets.findFirst({
    where: and(
      eq(aiProviderSecrets.tenantId, tenantId),
      eq(aiProviderSecrets.provider, provider),
      eq(aiProviderSecrets.keyType, 'system'),
      isNull(aiProviderSecrets.deletedAt),
    ),
  });
  if (system) {
    return {
      present: !!system.encryptedKey || provider === 'ollama' || provider === 'opencode',
      keyPrefix: system.keyPrefix,
      baseUrl: system.baseUrl,
      modelOverride: system.modelOverride,
      rotatedAt: system.rotatedAt,
      keyType: 'system',
    };
  }

  return { present: false, keyPrefix: null, baseUrl: null, modelOverride: null, rotatedAt: null, keyType: null };
}

/**
 * Return key-presence metadata for every supported provider in one round-trip.
 * Used by /api/tenant/admin/ai-providers GET to render the admin form
 * without ever pulling ciphertext into the response.
 */
export async function listProviderKeyMeta(
  tenantId: string,
  userId?: string,
): Promise<Record<string, {
  present: boolean;
  keyPrefix: string | null;
  baseUrl: string | null;
  modelOverride: string | null;
  rotatedAt: Date | null;
  keyType: KeyType | null;
}>> {
  const rows = await db
    .select({
      provider: aiProviderSecrets.provider,
      encryptedKey: aiProviderSecrets.encryptedKey,
      keyPrefix: aiProviderSecrets.keyPrefix,
      baseUrl: aiProviderSecrets.baseUrl,
      modelOverride: aiProviderSecrets.modelOverride,
      rotatedAt: aiProviderSecrets.rotatedAt,
      keyType: aiProviderSecrets.keyType,
      userId: aiProviderSecrets.userId,
    })
    .from(aiProviderSecrets)
    .where(and(
      eq(aiProviderSecrets.tenantId, tenantId),
      isNull(aiProviderSecrets.deletedAt),
    ));

  const keyPriority: Record<KeyType, number> = { personal: 3, tenant: 2, system: 1 };

  const out: Record<string, {
    present: boolean;
    keyPrefix: string | null;
    baseUrl: string | null;
    modelOverride: string | null;
    rotatedAt: Date | null;
    keyType: KeyType | null;
  }> = {};

  for (const row of rows) {
    const rid = row.provider;
    const rowKey = row.encryptedKey || row.provider === 'ollama' || row.provider === 'opencode';
    if (!rowKey) continue;

    const rowPriority = keyPriority[row.keyType as KeyType] ?? 0;
    const currentPriority = out[rid]?.keyType ? keyPriority[out[rid].keyType!] : -1;

    if (row.keyType === 'personal' && userId && row.userId !== userId) continue;

    if (rowPriority > currentPriority) {
      out[rid] = {
        present: true,
        keyPrefix: row.keyPrefix,
        baseUrl: row.baseUrl,
        modelOverride: row.modelOverride,
        rotatedAt: row.rotatedAt,
        keyType: row.keyType as KeyType,
      };
    }
  }
  return out;
}

/**
 * List all keys for a tenant (used by superadmin system key management).
 */
export async function listAllKeysForTenant(
  tenantId: string,
): Promise<Array<{
  provider: string;
  keyType: KeyType;
  userId: string | null;
  keyPrefix: string | null;
  baseUrl: string | null;
  modelOverride: string | null;
  rotatedAt: Date | null;
}>> {
  const rows = await db
    .select({
      provider: aiProviderSecrets.provider,
      keyPrefix: aiProviderSecrets.keyPrefix,
      baseUrl: aiProviderSecrets.baseUrl,
      modelOverride: aiProviderSecrets.modelOverride,
      rotatedAt: aiProviderSecrets.rotatedAt,
      keyType: aiProviderSecrets.keyType,
      userId: aiProviderSecrets.userId,
    })
    .from(aiProviderSecrets)
    .where(and(
      eq(aiProviderSecrets.tenantId, tenantId),
      isNull(aiProviderSecrets.deletedAt),
    ));

  return rows.map(r => ({
    provider: r.provider,
    keyType: r.keyType as KeyType,
    userId: r.userId,
    keyPrefix: r.keyPrefix,
    baseUrl: r.baseUrl,
    modelOverride: r.modelOverride,
    rotatedAt: r.rotatedAt,
  }));
}

// ── Delete keys ───────────────────────────────────────────────────────

/**
 * Soft-delete the stored key for a (tenant, provider, keyType).
 */
export async function deleteProviderKey(
  tenantId: string,
  provider: string,
  keyType: KeyType = 'tenant',
  userId?: string,
): Promise<void> {
  assertValidKeyType(keyType);

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
