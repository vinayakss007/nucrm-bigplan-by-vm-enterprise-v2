import IORedis from 'ioredis';

const REDIS_URL = process.env['REDIS_URL'] || 'redis://localhost:6379';

export interface FlagDefinition {
  key: string;
  description: string;
  default: boolean;
  owner: string;
}

export interface FlagOverride {
  enabled: boolean;
  tenantIds?: string[];
  userIds?: string[];
  percentage?: number;
}

const DEFINED_FLAGS: FlagDefinition[] = [
  { key: 'dashboard-v2', description: 'New dashboard v2 with widget grid', default: true, owner: 'platform' },
  { key: 'ai-draft-emails', description: 'AI-powered email drafting in composer', default: false, owner: 'ai' },
  { key: 'bulk-export-csv', description: 'Enable bulk CSV export for contacts/deals', default: true, owner: 'platform' },
  { key: 'new-signup-flow', description: 'New simplified signup flow', default: false, owner: 'growth' },
  { key: 'audit-log-streaming', description: 'Real-time audit log streaming to Loki', default: false, owner: 'security' },
  { key: 'webhook-retry-v2', description: 'Exponential backoff retry for webhooks', default: true, owner: 'platform' },
  { key: 'sso-saml', description: 'SSO/SAML login (enterprise)', default: false, owner: 'enterprise' },
  { key: 'rate-limit-strict', description: 'Strict rate limiting for free tier', default: false, owner: 'platform' },
  { key: 'performance-tracing', description: 'Enable Sentry performance traces', default: true, owner: 'platform' },
  { key: 'maintenance-mode', description: 'Kill switch — blocks all non-admin traffic', default: false, owner: 'ops' },
];

const CACHE_TTL = 30;

function getRedis(): IORedis {
  return new IORedis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
}

function hashUserId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

async function getFlagOverrides(): Promise<Record<string, FlagOverride>> {
  const redis = getRedis();
  try {
    await redis.connect();
    const raw = await redis.get('flags:overrides');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('[Flags] Failed to get flag overrides', e);
    return {};
  } finally {
    redis.disconnect();
  }
}

export async function isEnabled(
  key: string,
  context?: { tenantId?: string; userId?: string }
): Promise<boolean> {
  const def = DEFINED_FLAGS.find(f => f.key === key);
  if (!def) return false;

  const overrides = await getFlagOverrides();
  const override = overrides[key];
  if (!override) return def.default;

  if (!override.enabled) return false;

  if (override.tenantIds?.length && context?.tenantId) {
    if (override.tenantIds.includes(context.tenantId)) return true;
  }

  if (override.userIds?.length && context?.userId) {
    if (override.userIds.includes(context.userId)) return true;
  }

  if (override.percentage != null && context?.userId) {
    const bucket = hashUserId(context.userId) % 100;
    if (bucket < override.percentage) return true;
  }

  return def.default;
}

export async function setOverride(
  key: string,
  override: FlagOverride
): Promise<void> {
  const redis = getRedis();
  try {
    await redis.connect();
    const raw = await redis.get('flags:overrides');
    const overrides: Record<string, FlagOverride> = raw ? JSON.parse(raw) : {};
    overrides[key] = override;
    await redis.setex('flags:overrides', CACHE_TTL * 10, JSON.stringify(overrides));
  } finally {
    redis.disconnect();
  }
}

export async function deleteOverride(key: string): Promise<void> {
  const redis = getRedis();
  try {
    await redis.connect();
    const raw = await redis.get('flags:overrides');
    const overrides: Record<string, FlagOverride> = raw ? JSON.parse(raw) : {};
    delete overrides[key];
    await redis.setex('flags:overrides', CACHE_TTL * 10, JSON.stringify(overrides));
  } finally {
    redis.disconnect();
  }
}

export async function getAllFlags(
  context?: { tenantId?: string; userId?: string }
): Promise<Array<FlagDefinition & { enabled: boolean; override?: FlagOverride }>> {
  const results: Array<FlagDefinition & { enabled: boolean; override?: FlagOverride }> = [];
  for (const def of DEFINED_FLAGS) {
    results.push({
      ...def,
      enabled: await isEnabled(def.key, context),
    });
  }
  return results;
}

export { DEFINED_FLAGS, CACHE_TTL };
