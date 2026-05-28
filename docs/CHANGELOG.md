# Changelog

All notable changes to NuCRM are documented here.

---

## [Unreleased]

### Plugin System (New)

A complete custom plugin system that lets users connect to ANY external API.

- **Schema**: `custom_plugins` + `plugin_execution_logs` tables in `drizzle/schema/plugins.ts`
- **Engine**: HTTP execution engine (`lib/plugins/engine.ts`) with 6 auth types:
  - `bearer` - Authorization: Bearer token
  - `basic` - Authorization: Basic base64(user:pass)
  - `api_key_header` - Custom header name with API key value
  - `api_key_query` - API key appended as query parameter
  - `oauth2_client_credentials` - Fetches token from tokenUrl first, then uses it
  - `none` - No authentication
- **Variable Interpolation**: `{{variable}}` syntax in URL paths and request body templates
- **Webhook Receiver**: Inbound webhook endpoint with HMAC-SHA256 signature verification
- **Encryption**: Credentials encrypted at rest using AES-256-GCM (`lib/plugins/crypto.ts`)
- **Rate Limiting**: Sliding-window rate limiter (60 req/min per plugin) on webhook routes
- **API**: Full CRUD at `/api/tenant/plugins/` with endpoints for:
  - `GET /api/tenant/plugins/` - List all tenant plugins
  - `POST /api/tenant/plugins/` - Create new plugin
  - `GET /api/tenant/plugins/[id]/` - Get plugin detail
  - `PATCH /api/tenant/plugins/[id]/` - Update plugin
  - `DELETE /api/tenant/plugins/[id]/` - Soft delete plugin
  - `POST /api/tenant/plugins/[id]/test/` - Test connection
  - `POST /api/tenant/plugins/[id]/execute/` - Execute an action
  - `GET /api/tenant/plugins/[id]/logs/` - Paginated execution logs
  - `POST /api/tenant/plugins/webhook/[id]/` - Inbound webhook receiver
- **UI**: Full management page at `/tenant/plugins` with:
  - Create wizard (basic info, auth config, actions, review)
  - Plugin templates (Generic REST, Stripe-style, GitHub API)
  - Execution log viewer
  - Enable/disable toggles and test buttons

### Architecture Separation

Three distinct systems are now properly separated:

| System       | Purpose                                    | Location            |
| ------------ | ------------------------------------------ | ------------------- |
| Modules      | Internal feature packs (plan-gated)        | `lib/modules/`      |
| Integrations | First-party curated providers              | `lib/integrations/` |
| Plugins      | User-created custom connectors             | `lib/plugins/`      |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full details.

### Docker Compose Separation

- `docker-compose.yml` (root) - Lean dev environment with just Redis. App runs via `npm run dev` on host.
- `deploy/docker-compose.production.yml` - Full production stack with nginx, app (x2 replicas), worker, cron, Redis, MinIO, and monitoring. PostgreSQL runs on the host.

### Contributor Fixes (PR #39)

Fixes from opencode contributor addressing multiple build and runtime issues:

- Fixed broken `db.insert().values({} as any)` pattern across 5 route files
- Fixed column name mismatches (`type` -> `eventType`, `event` -> `eventType`, `stageOrder` -> `order`)
- Fixed pipeline/stage creation in industry-templates
- Added missing Products page (`/tenant/products`)
- Added missing Import/Export page (`/tenant/settings/import-export`)
- CSRF exemption for `/api/setup/` and `/api/tenant/onboarding/`
- DB migration: `role` -> `role_slug` rename in invitations table
- Cron scheduler env access fix for TypeScript strict mode

### Font Color Fix

Changed text colors for better readability:

- **Light mode**: Foreground color changed from dull dark (`hsl(222, 24%, 10%)`) to pure black (`hsl(0, 0%, 0%)`)
- **Dark mode**: Foreground color changed from muted light (`hsl(210, 20%, 92%)`) to pure white (`hsl(0, 0%, 100%)`)
- Updated `--foreground`, `--card-foreground`, `--popover-foreground`, and `--secondary-foreground` in both modes
