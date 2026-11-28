# NuCRM document MCP server (read-only)

A tiny stateless [MCP](https://modelcontextprotocol.io) server that gives an AI agent read access
to a NuCRM tenant's stored documents. It never touches the database directly: every tool calls the
documented NuCRM REST API with a tenant-scoped API key.

## Tools

| Tool                     | What it does                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `crm_documents_list`     | List documents (filters: `entityType`, `entityId`, `folderId`, `page`, `limit`).                       |
| `crm_document_get`       | Metadata + a 10-minute signed download URL.                                                            |
| `crm_document_read_text` | Download a text-based document and return its content (2 MiB cap). Binary files return metadata + URL. |

All tools are annotated `readOnlyHint: true`.

## Run

From the repository root (the SDK is already installed there):

```bash
NUCRM_URL=https://your-domain.com \
NUCRM_API_KEY=ak_live_... \
PORT=3100 \
npx tsx examples/mcp-documents/server.ts
```

The endpoint is `http://localhost:3100/mcp`. It implements stateless Streamable HTTP: no session
handshake, no sticky routing, one JSON-RPC message per POST.

### Client config

```json
{
  "mcpServers": {
    "nucrm-documents": {
      "url": "http://localhost:3100/mcp",
      "headers": { "Authorization": "Bearer ak_live_..." }
    }
  }
}
```

`NUCRM_API_KEY` acts as the fallback when the client does not send an `Authorization` header.
Prefer per-client keys so each agent's access can be revoked independently.

## Security notes

- Mint a narrow key: `documents.view` only. Do not use `*` or `all`.
- One key = one tenant. Never let a client choose a tenant id.
- The signed download URL is a capability credential — do not log or persist it.
- Text reads are capped at 2 MiB by default; override with `MAX_TEXT_BYTES` in code if needed.

## Verify

```bash
npx vitest run tests/unit/mcp-documents-service.test.ts
```

See [the AI service quickstart](../../docs/public/developer/ai-service-quickstart.md) for the REST
and SDK equivalents.
