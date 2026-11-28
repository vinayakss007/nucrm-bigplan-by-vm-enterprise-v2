/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Read-only MCP server for NuCRM stored documents.
 *
 * Stateless Streamable HTTP (MCP 2026-07-28): every JSON-RPC message is its own
 * POST, no session id, no sticky routing. Each request gets a fresh server and
 * transport, and talks to NuCRM through the public REST API with an API key.
 */
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

const TEXT_MIME = /^(text\/|application\/(json|xml|csv|javascript|markdown|x-www-form-urlencoded))|markdown/i;

export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export interface ServiceConfig {
  baseUrl: string;
  apiKey?: string;
  maxTextBytes?: number;
}

export function apiKeyFromRequest(request: Request, fallback?: string): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(ak_[A-Za-z0-9_-]+)$/i.exec(header);
  return match?.[1] ?? fallback ?? null;
}

export function isTextMime(mimeType: string): boolean {
  return TEXT_MIME.test(mimeType);
}

function toolText(payload: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function toolError(message: string): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function crmFetch(baseUrl: string, key: string, path: string): Promise<unknown> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/tenant${path}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `NuCRM returned ${response.status}`;
    throw new Error(`${message} (${response.status})`);
  }
  return body;
}

export function createDocumentServer(config: ServiceConfig): McpServer {
  const server = new McpServer({ name: 'nucrm-documents', version: '1.0.0' });
  const maxBytes = config.maxTextBytes ?? MAX_TEXT_BYTES;

  server.registerTool(
    'crm_documents_list',
    {
      title: 'List NuCRM documents',
      description: 'List stored documents in the authenticated NuCRM tenant. Read-only.',
      inputSchema: {
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        entityType: z.string().optional().describe('e.g. deal, contact, company'),
        entityId: z.string().uuid().optional(),
        folderId: z.string().uuid().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args, extra) => {
      const key = extra.authInfo?.token ?? config.apiKey;
      if (!key) return toolError('No NuCRM API key supplied.');
      const params = new URLSearchParams();
      if (args.page !== undefined) params.set('page', String(args.page));
      if (args.limit !== undefined) params.set('limit', String(args.limit));
      if (args.entityType) params.set('entityType', args.entityType);
      if (args.entityId) params.set('entityId', args.entityId);
      if (args.folderId) params.set('folderId', args.folderId);
      const query = params.size ? `?${params}` : '';
      try {
        return toolText(await crmFetch(config.baseUrl, key, `/documents${query}`));
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'NuCRM request failed');
      }
    }
  );

  server.registerTool(
    'crm_document_get',
    {
      title: 'Get a NuCRM document',
      description: 'Get document metadata and a 10-minute signed download URL. Read-only.',
      inputSchema: { id: z.string().uuid().describe('Document id from crm_documents_list') },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args, extra) => {
      const key = extra.authInfo?.token ?? config.apiKey;
      if (!key) return toolError('No NuCRM API key supplied.');
      try {
        const envelope = await crmFetch(config.baseUrl, key, `/documents/${args.id}`) as { data?: unknown };
        return toolText(envelope.data ?? envelope);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'NuCRM request failed');
      }
    }
  );

  server.registerTool(
    'crm_document_read_text',
    {
      title: 'Read a NuCRM document as text',
      description:
        'Download a text-based document and return its content (capped at 2 MiB). For binary files it returns metadata and the signed URL instead.',
      inputSchema: { id: z.string().uuid().describe('Document id from crm_documents_list') },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args, extra) => {
      const key = extra.authInfo?.token ?? config.apiKey;
      if (!key) return toolError('No NuCRM API key supplied.');
      try {
        const envelope = await crmFetch(config.baseUrl, key, `/documents/${args.id}`) as {
          data?: { name?: string; mimeType?: string; download_url?: string };
        };
        const doc = envelope.data ?? {};
        if (!doc.download_url) return toolError('Document has no signed download URL.');
        if (!isTextMime(doc.mimeType ?? '')) {
          return toolText({
            name: doc.name,
            mimeType: doc.mimeType,
            download_url: doc.download_url,
            note: 'Binary document: fetch download_url with your own tooling.',
          });
        }
        const response = await fetch(doc.download_url);
        if (!response.ok) return toolError(`Download failed with ${response.status}`);
        const length = Number(response.headers.get('content-length') ?? '0');
        if (length > maxBytes) return toolError(`Document exceeds the ${maxBytes}-byte text limit.`);
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > maxBytes) return toolError(`Document exceeds the ${maxBytes}-byte text limit.`);
        return toolText({
          name: doc.name,
          mimeType: doc.mimeType,
          content: new TextDecoder().decode(buffer),
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'NuCRM request failed');
      }
    }
  );

  return server;
}

/** Handle one stateless MCP HTTP request. */
export async function handleMcpRequest(request: Request, config: ServiceConfig): Promise<Response> {
  const key = apiKeyFromRequest(request, config.apiKey);
  if (!key) return Response.json({ error: 'NuCRM API key required' }, { status: 401 });

  const server = createDocumentServer(config);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request, {
      authInfo: { token: key, clientId: 'nucrm-api-key', scopes: [] },
    });
  } finally {
    await server.close().catch(() => undefined);
  }
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const method = req.method ?? 'GET';
  return new Request(`http://localhost${req.url ?? '/mcp'}`, {
    method,
    headers: req.headers as Record<string, string>,
    body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
  });
}

/** Entry point when run directly with tsx. */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const config: ServiceConfig = {
    baseUrl: process.env.NUCRM_URL ?? 'http://localhost:3000',
    apiKey: process.env.NUCRM_API_KEY,
  };
  const port = Number(process.env.PORT ?? 3100);
  createServer(async (req, res) => {
    if ((req.url ?? '').split('?')[0] !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    try {
      const response = await handleMcpRequest(await toWebRequest(req), config);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'MCP server error' }));
    }
  }).listen(port, () => {
    console.log(`NuCRM document MCP server on http://localhost:${port}/mcp (stateless)`);
  });
}
