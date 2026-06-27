/**
 * Multi-provider AI Gateway
 *
 * Single entry point for every AI capability in the product (auto-draft,
 * lead scoring, predict-deal, suggest-followup, summarize, …).
 *
 * Replaces the previous direct call to Anthropic in app/api/tenant/ai/route.ts.
 *
 * Providers:
 *   • OpenAI    — POST {base}/v1/chat/completions   (Bearer auth)
 *   • Anthropic — POST {base}/v1/messages           (x-api-key header)
 *   • Groq      — OpenAI-compatible chat.completions endpoint
 *   • Ollama    — POST {base}/api/chat               (no key; self-hosted)
 *
 * Fallback chain:
 *   1. If `provider` is supplied, try that first.
 *   2. Otherwise iterate enabled providers ascending by `fallback_priority`.
 *   3. On per-attempt failure (5xx / network / auth) try the next one.
 *   4. On 4xx that's not auth (e.g. 400 invalid request), surface immediately.
 *
 * Every attempt writes one row to `ai_activity` so /tenant/ai/activity
 * sees the full history including fallbacks.
 *
 * Token-budget gates remain via lib/ai/common.ts (checkTokenAndLimits +
 * recordUsage) — they live one level above this gateway.
 */
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema/core';
import { aiActivity } from '@/drizzle/schema/ai';
import { eq, and } from 'drizzle-orm';
import { getProviderKey, isNamedProvider, type KeyType } from './secrets';
import { checkCredits, deductCredits, isCentralizedProvider } from './credits';

export type GatewayMessage = { role: 'user' | 'assistant'; content: string };

export interface GatewayRequest {
  tenantId: string;
  userId: string | null;
  /** Capability name — written to ai_activity.action ('draft', 'lead_scoring', …) */
  action: string;
  /** Force a specific provider; otherwise fallback chain is used. Any string accepted — unknown providers use OpenAI-compatible format. */
  provider?: string;
  /** Override the provider's default model */
  model?: string;
  /** System prompt — pulled out of `messages` for providers that take it separately */
  system?: string;
  messages: GatewayMessage[];
  max_tokens?: number;
  temperature?: number;
  /** Optional record this call is about (entity_type/id are written to ai_activity) */
  entityType?: string;
  entityId?: string;
  /** Free-form details written to ai_activity.metadata */
  metadata?: Record<string, unknown>;
}

export interface GatewayResponse {
  text: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  /** Number of providers tried before this one succeeded (0 = first try) */
  fallbacksUsed: number;
  /** Inserted ai_activity row id of the successful attempt */
  activityId: string | null;
}

export class GatewayError extends Error {
  code:
    | 'no_provider_enabled'
    | 'no_key_for_provider'
    | 'all_providers_failed'
    | 'invalid_request'
    | 'unknown';
  provider?: string;
  status?: number;
  constructor(code: GatewayError['code'], message: string, opts: { provider?: string; status?: number } = {}) {
    super(message);
    this.code = code;
    this.name = 'GatewayError';
    if (opts.provider) this.provider = opts.provider;
    if (opts.status) this.status = opts.status;
  }
}

// ── Provider config (lives in tenants.settings.ai_providers) ──────────────

interface ProviderConfig {
  enabled: boolean;
  default_model: string;
  temperature: number;
  max_tokens: number;
  fallback_priority: number;
  base_url?: string;
}

const PROVIDER_DEFAULTS: Record<string, ProviderConfig> = {
  openai:    { enabled: false, default_model: 'gpt-4o-mini',              temperature: 0.4, max_tokens: 1024, fallback_priority: 1 },
  anthropic: { enabled: false, default_model: 'claude-3-5-sonnet-latest', temperature: 0.4, max_tokens: 1024, fallback_priority: 2 },
  groq:      { enabled: false, default_model: 'llama-3.1-70b-versatile',  temperature: 0.4, max_tokens: 1024, fallback_priority: 3 },
  ollama:    { enabled: false, default_model: 'llama3.1:8b',              temperature: 0.4, max_tokens: 1024, fallback_priority: 4, base_url: 'http://localhost:11434' },
  opencode:  { enabled: false, default_model: 'deepseek-v4-flash-free',   temperature: 0.4, max_tokens: 1024, fallback_priority: 5, base_url: 'https://opencode.ai/zen' },
  deepseek:  { enabled: false, default_model: 'deepseek-chat',            temperature: 0.4, max_tokens: 1024, fallback_priority: 6, base_url: 'https://api.deepseek.com' },
};

/** Approximate cost per 1K tokens (USD cents × 100 = sub-cent precision). */
const COST_PER_1K_TOKENS: Record<string, { in: number; out: number }> = {
  // OpenAI
  'gpt-4o-mini':              { in: 1.5,  out: 6.0 },
  'gpt-4o':                   { in: 25.0, out: 100.0 },
  // Anthropic
  'claude-3-5-haiku-20241022':  { in: 8.0,  out: 40.0 },
  'claude-3-5-sonnet-latest':   { in: 30.0, out: 150.0 },
  'claude-3-5-sonnet-20241022': { in: 30.0, out: 150.0 },
  // Groq (priced per the official table; rough)
  'llama-3.1-70b-versatile':  { in: 5.9,  out: 7.9 },
  'llama-3.1-8b-instant':     { in: 0.5,  out: 0.8 },
  // Ollama is self-hosted — zero
  'llama3.1:8b':              { in: 0.0,  out: 0.0 },
  // OpenCode — platform-provided AI (cost tracked via credits)
  'opencode':                 { in: 0.0,  out: 0.0 },
  // DeepSeek
  'deepseek-chat':            { in: 0.14, out: 0.28 },
};

function estimateCostCents(model: string, tokensIn: number, tokensOut: number): number {
  const rate = COST_PER_1K_TOKENS[model];
  if (!rate) return Math.round((tokensIn + tokensOut) * 0.001); // fallback heuristic
  return Math.round(((tokensIn * rate.in) + (tokensOut * rate.out)) / 10);
}

async function loadProviderConfigs(tenantId: string): Promise<Record<string, ProviderConfig>> {
  const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const stored = ((t?.settings as Record<string, unknown> | null) ?? {})['ai_providers'] as Record<string, Partial<ProviderConfig>> | undefined ?? {};
  const out: Record<string, ProviderConfig> = {};
  // Load named provider defaults first
  for (const id of Object.keys(PROVIDER_DEFAULTS)) {
    out[id] = { ...PROVIDER_DEFAULTS[id as keyof typeof PROVIDER_DEFAULTS], ...(stored[id] ?? {}) };
  }
  // Load any custom providers from stored config
  for (const [id, cfg] of Object.entries(stored)) {
    if (!out[id]) {
      out[id] = { enabled: false, default_model: '', temperature: 0.4, max_tokens: 1024, fallback_priority: 99, ...cfg };
    }
  }
  return out;
}

/** Pick the order to try providers in. Forced provider goes first, then enabled ones by fallback_priority asc. */
function buildProviderChain(
  configs: Record<string, ProviderConfig>,
  forced?: string,
): string[] {
  const enabled = Object.keys(configs)
    .filter(id => configs[id].enabled)
    .sort((a, b) => configs[a].fallback_priority - configs[b].fallback_priority);

  if (!forced) return enabled;
  return [forced, ...enabled.filter(id => id !== forced)];
}

// ── Provider implementations ──────────────────────────────────────────────

interface ProviderCall {
  text: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

async function callOpenAILike(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string | undefined,
  messages: GatewayMessage[],
  max_tokens: number,
  temperature: number,
): Promise<ProviderCall> {
  const body = {
    model,
    max_tokens,
    temperature,
    messages: [
      ...(system ? [{ role: 'system' as const, content: system }] : []),
      ...messages,
    ],
  };
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GatewayError(res.status === 401 || res.status === 403 ? 'no_key_for_provider' : 'all_providers_failed',
      `${res.status} ${text.slice(0, 200)}`,
      { status: res.status });
  }
  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
    model: data.model ?? model,
  };
}

async function callAnthropic(
  apiKey: string,
  model: string,
  system: string | undefined,
  messages: GatewayMessage[],
  max_tokens: number,
  temperature: number,
): Promise<ProviderCall> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens,
      temperature,
      ...(system ? { system } : {}),
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GatewayError(res.status === 401 || res.status === 403 ? 'no_key_for_provider' : 'all_providers_failed',
      `${res.status} ${text.slice(0, 200)}`,
      { status: res.status });
  }
  const data = await res.json();
  return {
    text: data.content?.[0]?.text ?? '',
    tokensIn: data.usage?.input_tokens ?? 0,
    tokensOut: data.usage?.output_tokens ?? 0,
    model: data.model ?? model,
  };
}

async function callOllama(
  baseUrl: string,
  model: string,
  system: string | undefined,
  messages: GatewayMessage[],
  max_tokens: number,
  temperature: number,
): Promise<ProviderCall> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      options: { temperature, num_predict: max_tokens },
      messages: [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        ...messages,
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GatewayError('all_providers_failed', `${res.status} ${text.slice(0, 200)}`, { status: res.status });
  }
  const data = await res.json();
  return {
    text: data.message?.content ?? '',
    tokensIn: data.prompt_eval_count ?? 0,
    tokensOut: data.eval_count ?? 0,
    model: data.model ?? model,
  };
}

async function callProvider(
  provider: string,
  cfg: ProviderConfig,
  apiKey: string,
  baseUrlOverride: string | null,
  modelOverride: string | null,
  req: GatewayRequest,
): Promise<ProviderCall> {
  const model = req.model ?? modelOverride ?? cfg.default_model;
  const max_tokens = req.max_tokens ?? cfg.max_tokens;
  const temperature = req.temperature ?? cfg.temperature;

  // Known providers with special API handling
  if (provider === 'anthropic') {
    return callAnthropic(apiKey, model, req.system, req.messages, max_tokens, temperature);
  }
  if (provider === 'ollama') {
    const url = baseUrlOverride || cfg.base_url || 'http://localhost:11434';
    return callOllama(url, model, req.system, req.messages, max_tokens, temperature);
  }

  // Everything else (openai, groq, opencode, custom, any new provider) → OpenAI-compatible
  const url = baseUrlOverride || cfg.base_url || getDefaultBaseUrl(provider);
  return callOpenAILike(url, apiKey, model, req.system, req.messages, max_tokens, temperature);
}

/** Fallback base URLs for named providers. Custom providers must supply a base_url. */
function getDefaultBaseUrl(provider: string): string {
  switch (provider) {
    case 'openai':    return 'https://api.openai.com';
    case 'groq':      return 'https://api.groq.com/openai';
    case 'opencode':  return 'https://opencode.ai/zen';
    case 'deepseek':  return 'https://api.deepseek.com';
    default:          return '';  // custom providers must have base_url set
  }
}

// ── ai_activity logger ────────────────────────────────────────────────────

interface LogPayload {
  tenantId: string;
  userId: string | null;
  action: string;
  provider: string;
  model: string | null;
  status: 'success' | 'error' | 'rate_limited' | 'fallback_used';
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  latencyMs: number;
  entityType: string | null;
  entityId: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
}

async function logActivity(p: LogPayload): Promise<string | null> {
  try {
    const [row] = await db.insert(aiActivity).values({
      tenantId: p.tenantId,
      userId: p.userId,
      action: p.action,
      provider: p.provider,
      model: p.model,
      status: p.status,
      tokensIn: p.tokensIn,
      tokensOut: p.tokensOut,
      tokensUsed: p.tokensIn + p.tokensOut,
      costCents: p.costCents,
      latencyMs: p.latencyMs,
      entityType: p.entityType,
      entityId: p.entityId,
      errorMessage: p.errorMessage,
      metadata: p.metadata,
    }).returning({ id: aiActivity.id });
    return row?.id ?? null;
  } catch (err) {
    // Never let activity logging break the actual call
    console.warn('[ai gateway] activity log failed:', (err as Error).message);
    return null;
  }
}

// ── Public entry point ────────────────────────────────────────────────────

export async function chat(req: GatewayRequest): Promise<GatewayResponse> {
  if (!Array.isArray(req.messages) || req.messages.length === 0) {
    throw new GatewayError('invalid_request', 'messages must be a non-empty array');
  }

  // Check if using centralized credits for the requested/first provider
  const isCentralized = await isCentralizedProvider(req.tenantId, req.provider ?? '');
  if (isCentralized) {
    const estimatedTokens = req.max_tokens ?? 1024;
    const creditCheck = await checkCredits(req.tenantId, estimatedTokens);
    if (!creditCheck.allowed) {
      throw new GatewayError('no_key_for_provider', creditCheck.reason ?? 'Insufficient credits');
    }
  }

  const configs = await loadProviderConfigs(req.tenantId);
  const chain = buildProviderChain(configs, req.provider);

  if (chain.length === 0) {
    throw new GatewayError('no_provider_enabled', 'No AI provider is enabled. Configure one at /tenant/settings/ai-providers.');
  }

  const errors: { provider: string; message: string; status?: number }[] = [];

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i]!;
    const cfg = configs[provider] ?? { enabled: false, default_model: '', temperature: 0.4, max_tokens: 1024, fallback_priority: 99 };
    const start = Date.now();

    let keyData: { plaintext: string; baseUrl: string | null; modelOverride: string | null; keyType: KeyType } | null = null;
    try {
      keyData = await getProviderKey(req.tenantId, provider, req.userId ?? undefined);
    } catch (err) {
      errors.push({ provider, message: `secrets vault: ${(err as Error).message}` });
      // Log a stub activity row so the failure shows up in the audit
      await logActivity({
        tenantId: req.tenantId, userId: req.userId, action: req.action,
        provider, model: req.model ?? cfg.default_model,
        status: 'error', tokensIn: 0, tokensOut: 0, costCents: 0, latencyMs: 0,
        entityType: req.entityType ?? null, entityId: req.entityId ?? null,
        errorMessage: `vault: ${(err as Error).message}`,
        metadata: { ...(req.metadata ?? {}), attempt: i },
      });
      continue;
    }

    if (!keyData && provider !== 'ollama' && provider !== 'opencode') {
      errors.push({ provider, message: 'no API key stored' });
      continue;
    }

    const apiKey = keyData?.plaintext ?? '';
    const baseUrlOverride = keyData?.baseUrl ?? null;
    const modelOverride = keyData?.modelOverride ?? null;

    try {
      const result = await callProvider(provider, cfg, apiKey, baseUrlOverride, modelOverride, req);
      const latencyMs = Date.now() - start;
      const costCents = estimateCostCents(result.model, result.tokensIn, result.tokensOut);

      const activityId = await logActivity({
        tenantId: req.tenantId, userId: req.userId, action: req.action,
        provider, model: result.model,
        status: i === 0 ? 'success' : 'fallback_used',
        tokensIn: result.tokensIn, tokensOut: result.tokensOut,
        costCents, latencyMs,
        entityType: req.entityType ?? null, entityId: req.entityId ?? null,
        errorMessage: null,
        metadata: { ...(req.metadata ?? {}), attempt: i, fallback_chain: chain, key_type: keyData?.keyType, model_override: modelOverride },
      });

      // Deduct credits if using centralized pool
      const providerIsCentralized = await isCentralizedProvider(req.tenantId, provider);
      if (providerIsCentralized) {
        await deductCredits({
          tenantId: req.tenantId,
          userId: req.userId,
          action: req.action,
          provider,
          model: result.model,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          costCents,
          activityId,
        });
      }

      return {
        text: result.text,
        provider,
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        latencyMs,
        fallbacksUsed: i,
        activityId,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = (err as Error).message;
      const status = (err as GatewayError).status;
      errors.push({ provider, message, status });

      await logActivity({
        tenantId: req.tenantId, userId: req.userId, action: req.action,
        provider, model: req.model ?? cfg.default_model,
        status: status === 429 ? 'rate_limited' : 'error',
        tokensIn: 0, tokensOut: 0, costCents: 0, latencyMs,
        entityType: req.entityType ?? null, entityId: req.entityId ?? null,
        errorMessage: message.slice(0, 1000),
        metadata: { ...(req.metadata ?? {}), attempt: i, fallback_chain: chain, key_type: keyData?.keyType, model_override: modelOverride },
      });

      // 400 / 422 (and other non-auth 4xx) are fatal — bail out
      if (typeof status === 'number' && status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 429) {
        throw new GatewayError('invalid_request', `${provider}: ${message}`, { provider, status });
      }
      // Otherwise keep going down the chain
    }
  }

  throw new GatewayError(
    'all_providers_failed',
    `All providers failed: ${errors.map(e => `${e.provider}(${e.message})`).join('; ')}`,
  );
}

/** Convenience helper for the very common 'one-shot' chat with a system prompt. */
export async function complete(req: Omit<GatewayRequest, 'messages'> & { user: string }): Promise<GatewayResponse> {
  return chat({ ...req, messages: [{ role: 'user', content: req.user }] });
}
