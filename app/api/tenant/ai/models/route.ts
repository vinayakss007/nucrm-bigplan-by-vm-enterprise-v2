/**
 * Fetch available models from an AI provider's base URL.
 *   GET /api/tenant/ai/models?provider=openai&base_url=https://api.openai.com&api_key=sk-...
 *
 * Supports:
 *   - OpenAI-compatible providers (OpenAI, Groq, OpenCode, etc.) — GET /v1/models
 *   - Anthropic — GET /v1/models (with x-api-key header)
 *   - Ollama — GET /api/tags
 *
 * Returns: { models: [{ id, name, owned_by? }] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { apiError } from '@/lib/api-error';

interface ModelEntry {
  id: string;
  name: string;
  owned_by?: string;
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  groq: 'https://api.groq.com/openai',
  ollama: 'http://localhost:11434',
  opencode: 'https://opencode.ai/zen',
};

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const provider = req.nextUrl.searchParams.get('provider');
    const baseUrl = req.nextUrl.searchParams.get('base_url')?.trim();
    const apiKey = req.nextUrl.searchParams.get('api_key')?.trim();

    if (!provider) {
      return NextResponse.json({ error: 'provider is required' }, { status: 400 });
    }

    const effectiveBase = baseUrl || DEFAULT_BASE_URLS[provider] || '';
    if (!effectiveBase) {
      return NextResponse.json({ error: 'base_url is required for this provider' }, { status: 400 });
    }

    let models: ModelEntry[] = [];

    if (provider === 'ollama') {
      // Ollama: GET /api/tags
      try {
        const res = await fetch(`${effectiveBase}/api/tags`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          const data = await res.json();
          models = (data.models ?? []).map((m: { name: string }) => ({
            id: m.name,
            name: m.name,
            owned_by: 'ollama',
          }));
        }
      } catch {
        // Ollama might not be running
        return NextResponse.json({ models: [], error: 'Could not connect to Ollama. Is it running?' });
      }
    } else if (provider === 'anthropic') {
      // Anthropic doesn't have a public /v1/models endpoint, return known models
      models = [
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', owned_by: 'anthropic' },
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', owned_by: 'anthropic' },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', owned_by: 'anthropic' },
        { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', owned_by: 'anthropic' },
        { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', owned_by: 'anthropic' },
      ];
    } else {
      // OpenAI-compatible: GET /v1/models (OpenAI, Groq, OpenCode, etc.)
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }
        const res = await fetch(`${effectiveBase}/v1/models`, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          const data = await res.json();
          models = (data.data ?? []).map((m: { id: string; owned_by?: string }) => ({
            id: m.id,
            name: m.id,
            owned_by: m.owned_by,
          }));
          // Sort alphabetically
          models.sort((a, b) => a.id.localeCompare(b.id));
        } else {
          const text = await res.text().catch(() => '');
          return NextResponse.json({
            models: [],
            error: `Provider returned ${res.status}: ${text.slice(0, 200)}`,
          });
        }
      } catch (err) {
        return NextResponse.json({
          models: [],
          error: `Could not connect to ${effectiveBase}/v1/models: ${(err as Error).message}`,
        });
      }
    }

    return NextResponse.json({ models, base_url: effectiveBase });
  } catch (err) {
    return apiError(err);
  }
}
