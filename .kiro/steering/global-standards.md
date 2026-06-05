# NuCRM Global Engineering Standards

This document defines mandatory coding standards, performance requirements, and architectural rules for the NuCRM enterprise SaaS platform. All contributions MUST comply.

---

## 1. Architecture Principles

### 1.1 Multi-Tenant Isolation
- Every database query on tenant data MUST include a `tenant_id` filter or use row-level security.
- NEVER expose one tenant's data to another. This is a security-critical invariant.
- Cache keys MUST be scoped by tenant: `tenant:{tenantId}:{resource}`.

### 1.2 No AI on Hot Paths
- AI is NOT load-bearing. The product MUST function fully with AI disabled.
- AI is ONLY allowed for chart-type recommendation given data shape.
- Minor AI uses (field-mapping hints, schema classification, insight bullets) MUST have a deterministic fallback that fully ships.
- All AI calls go through a single gateway with Zod-validated JSON-schema responses, env+customer toggles, and silent fallback on failure.

### 1.3 Deterministic-First
- Layout, colors, anomaly detection, forecasting, aggregation choice, NL-to-SQL, NL-to-dashboard MUST be deterministic algorithms, never AI.
- No mocks, no fakes, no placeholder/stub code in production paths.

---

## 2. Performance Standards

### 2.1 Server-Side
- **Database queries**: Statement timeout is 10s max. Optimize queries that exceed 200ms.
- **Connection pooling**: Always use the singleton pool (`lib/db/pool.ts`). NEVER create a new `Pool()` in API routes (except cron jobs that do try/finally cleanup).
- **N+1 queries**: Batch-fetch related data upfront. NEVER query inside a loop when you can pre-fetch.
- **Cache eviction**: Use O(1) eviction (Map insertion order). NEVER sort all entries to find the oldest.
- **Redis KEYS command**: NEVER use `KEYS` in production. Use `SCAN` for pattern-based deletion.
- **In-memory caches**: MUST have a size cap (MAX_ENTRIES). Eviction is mandatory.

### 2.2 Client-Side
- **Event listeners**: Every `addEventListener` MUST have a corresponding `removeEventListener` in cleanup. No exceptions.
- **useEffect cleanup**: Every subscription, interval, or listener in useEffect MUST return a cleanup function.
- **Bundle size**: Heavy libraries (`@xyflow/react`, `recharts`, `@aws-sdk`) MUST be dynamically imported or server-only.
- **Re-renders**: Use `useMemo`/`useCallback` for expensive computations passed as props.
- **LocalStorage cache**: Cap at 2MB. Evict expired entries on page load.

### 2.3 Background Workers
- **Bulk operations**: Process in parallel batches (batch size 5-10), not sequentially.
- **Dynamic imports**: Import once at the top of the worker handler, NOT inside each job iteration.
- **Intervals**: Always call `.unref()` on timers that should not keep the process alive.
- **Graceful shutdown**: All workers MUST handle SIGTERM and SIGINT, close connections, and exit cleanly.

---

## 3. Memory Leak Prevention

### 3.1 Mandatory Rules
- **No unbounded arrays/Maps**: Every collection that grows over time MUST have a max size and eviction strategy.
- **Ring buffers for metrics**: Use fixed-size ring buffers, not push-to-array.
- **Singleton Redis connections**: NEVER create multiple Redis clients for the same purpose. Reuse the singleton from `lib/cache/index.ts`.
- **Pool cleanup in cron**: If a cron route creates a Pool, it MUST use try/finally to ensure `pool.end()` is always called.
- **BroadcastChannel**: Always `.close()` in cleanup.
- **Timers**: `setInterval` MUST be paired with `clearInterval` in a cleanup path.

### 3.2 Testing for Leaks
- Monitor `process.memoryUsage().heapUsed` in long-running workers.
- In-memory caches should log their size periodically in development.
- Use `--max-old-space-size` to enforce memory limits in production containers.

---

## 4. Security Standards

### 4.1 Authentication & Authorization
- All protected API routes require JWT verification via middleware.
- CSRF protection is mandatory for state-changing requests (POST, PUT, PATCH, DELETE) from cookie-based sessions.
- API keys are scoped per tenant. Never allow cross-tenant access.
- Rate limiting is applied per-IP and per-user. Limits are configured in `lib/rate-limit.ts`.

### 4.2 Input Validation
- All user input MUST be validated with Zod schemas before processing.
- SQL injection prevention: Use parameterized queries exclusively. Table names MUST be from a whitelist (`VALID_TABLES` in `lib/db/client.ts`).
- XSS prevention: Sanitize HTML output with DOMPurify on the client.

### 4.3 Secrets Management
- NEVER log secrets, tokens, or passwords (even partially).
- Use environment variables for all secrets. Never hardcode.
- JWT secrets MUST be at least 32 bytes.

---

## 5. Code Organization

### 5.1 File Structure
```
app/api/          → API routes (Next.js App Router)
app/tenant/       → Tenant-facing pages
app/admin/        → Super admin pages
components/       → React components (shared/, tenant/, admin/, ui/)
lib/              → Server utilities (db, cache, auth, email, queue)
drizzle/          → Database schema and migrations
scripts/          → CLI scripts (migrations, seeds, backups)
```

### 5.2 Naming Conventions
- Files: `kebab-case.ts` (e.g., `rate-limit.ts`)
- Components: `PascalCase.tsx` (e.g., `ContactList.tsx`)
- API routes: `route.ts` inside the appropriate directory
- Types/interfaces: PascalCase, prefixed with `I` only when disambiguating
- Constants: `UPPER_SNAKE_CASE`

### 5.3 Import Rules
- Use `@/` path alias for all imports from the project root.
- Server-only code MUST NOT be imported into client components.
- Dynamic import heavy libraries: `const { X } = await import('heavy-lib')`.

---

## 6. Database Standards

### 6.1 Schema Rules
- Every table MUST have: `id` (UUID), `created_at`, `updated_at`.
- Tenant-scoped tables MUST have a `tenant_id` column with an index.
- Use Drizzle ORM for schema definitions. Raw SQL only for migrations and complex queries.
- Foreign keys are enforced. Cascading deletes only where explicitly justified.

### 6.2 Query Performance
- Pagination: Use `LIMIT`/`OFFSET` with a cap (max 500 rows per request).
- Indexes: Every frequently-filtered column MUST have an index.
- `COUNT(*)`: Use `::int` cast to avoid BigInt serialization issues.
- Transactions: Use `withTransaction()` from `lib/db/client.ts` for multi-step operations.

### 6.3 Migrations
- Forward-only migrations. Rollbacks are separate scripts.
- Test migrations on a copy of production data before deploying.
- Never drop columns in the same release that removes code reading them (two-phase).

---

## 7. Error Handling

### 7.1 API Error Responses
- Always return structured JSON: `{ error: string, code?: string, details?: any }`.
- Use appropriate HTTP status codes (400, 401, 403, 404, 409, 422, 429, 500).
- Log server errors with context (tenant_id, user_id, request path).
- NEVER expose internal error details (stack traces, SQL) to clients.

### 7.2 Client Error Handling
- Use toast notifications for user-facing errors.
- Retry failed network requests with exponential backoff (max 3 retries).
- Show meaningful error states, not blank screens.

---

## 8. Testing Standards

### 8.1 Required Coverage
- All API routes: unit tests for happy path + error cases.
- Database operations: integration tests with a test database.
- Critical business logic: isolated unit tests.

### 8.2 Test Rules
- Tests MUST be deterministic — no reliance on wall clock or external services.
- Use `vitest` for unit/integration tests, `playwright` for E2E.
- Mock external services (email, S3, Redis) in unit tests.
- NEVER use `--watch` mode in CI — always use `vitest run`.

---

## 9. Deployment & Operations

### 9.1 Build Requirements
- TypeScript: strict mode, no `any` unless explicitly justified.
- Build MUST pass with zero errors before merge.
- Bundle analysis: run `npm run analyze:bundle` before major dependency additions.

### 9.2 Environment Variables
- All required env vars are documented in `.env.example`.
- Feature flags use `FEATURE_*` prefix.
- AI toggles use `AI_ENABLED` and `AI_GATEWAY_URL`.

### 9.3 Monitoring
- Health check endpoint: `/api/health`.
- Redis and database health checked on startup.
- Sentry for error tracking (configured via env vars).
- Structured logging with request context (tenant, user, path, duration).

---

## 10. Git & PR Standards

### 10.1 Branch Naming
- `feat/short-description` — new features
- `fix/short-description` — bug fixes
- `perf/short-description` — performance improvements
- `chore/short-description` — maintenance, deps, tooling

### 10.2 Commit Messages
- Format: `type(scope): description` (e.g., `fix(cache): use SCAN instead of KEYS`)
- Types: feat, fix, perf, refactor, docs, test, chore
- Keep subject line under 72 characters.

### 10.3 PR Requirements
- Description with summary of changes.
- Must pass CI (lint, type-check, tests).
- No `console.log` in production code (use structured logging).
- Performance-sensitive changes require before/after metrics.
