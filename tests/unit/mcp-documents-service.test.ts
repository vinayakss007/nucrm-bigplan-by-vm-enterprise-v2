import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  apiKeyFromRequest,
  isTextMime,
  handleMcpRequest,
  type ServiceConfig,
} from '../../examples/mcp-documents/server';

const config: ServiceConfig = {
  baseUrl: 'https://crm.example',
  apiKey: 'ak_live_fallback',
};

function mcpRequest(body: unknown, key?: string): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'Mcp-Method': String((body as { method?: string }).method ?? ''),
  };
  if (key !== null) headers['authorization'] = `Bearer ${key ?? 'ak_live_client'}`;
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('mcp-documents service', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('extracts only well-formed ak_ bearer keys', () => {
    expect(apiKeyFromRequest(new Request('http://x', { headers: { authorization: 'Bearer ak_live_abc123' } })))
      .toBe('ak_live_abc123');
    expect(apiKeyFromRequest(new Request('http://x', { headers: { authorization: 'Bearer jwt.token' } })))
      .toBeNull();
    expect(apiKeyFromRequest(new Request('http://x'), 'ak_live_fallback')).toBe('ak_live_fallback');
  });

  it('classifies text MIME types for in-band reads', () => {
    expect(isTextMime('text/csv')).toBe(true);
    expect(isTextMime('application/json')).toBe(true);
    expect(isTextMime('application/pdf')).toBe(false);
  });

  it('refuses requests without an API key', async () => {
    const response = await handleMcpRequest(mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, null), {
      baseUrl: config.baseUrl,
    });
    expect(response.status).toBe(401);
  });

  it('advertises the read-only document tool catalog', async () => {
    const response = await handleMcpRequest(mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), config);
    expect(response.ok).toBe(true);
    const body = await response.json();
    const names = (body.result?.tools ?? []).map((tool: { name: string }) => tool.name);
    expect(names).toEqual(['crm_documents_list', 'crm_document_get', 'crm_document_read_text']);
  });

  it('lists documents through the public REST API with the tenant key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { documents: [{ id: 'd-1', name: 'a.pdf' }], folders: [] },
      page: 1,
      limit: 5,
      total: 1,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleMcpRequest(mcpRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'crm_documents_list', arguments: { entityType: 'deal', limit: 5 } },
    }), config);

    expect(response.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/api/tenant/documents');
    expect(parsed.searchParams.get('entityType')).toBe('deal');
    expect(parsed.searchParams.get('limit')).toBe('5');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ak_live_client');
    const body = await response.json();
    expect(body.result?.content?.[0]?.text).toContain('a.pdf');
  });

  it('returns a tool error when NuCRM rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Permission denied: documents.view required' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )));
    const response = await handleMcpRequest(mcpRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'crm_documents_list', arguments: {} },
    }), config);
    const body = await response.json();
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toContain('documents.view');
  });
});
