# Contributing to NuCRM

## Development Setup

```bash
git clone <repo>
cd nu2-crm
cp .env.example .env.local
npm install
npm run db:push
npm run dev
```

## Project Structure

```
app/                    # Next.js App Router
  api/                  # 223 REST endpoints
  tenant/               # 103 CRM pages
  superadmin/           # 19 admin pages
  portal/               # 5 customer portal pages
  auth/                 # Login, signup, 2FA
components/             # UI components
  ui/                   # Shared (20+ Radix-based)
  tenant/               # CRM-specific
  shared/               # Cross-cutting
lib/                    # Core logic
  auth/                 # JWT, CSRF, sessions
  cache/                # Redis + memory
  integrations/         # Plugin engine
  modules/              # Module SDK + registry
  tenant/               # Multi-tenant context
drizzle/                # Database
  schema/               # 163 tables, 13 files
  migrations/           # DDL + indexes + RLS
tests/                  # Test suite
  unit/                 # 108+ unit tests
  integration/          # Multi-tenant, validation
  e2e/                  # Playwright specs
```

## Code Standards

### TypeScript
- Strict mode enabled (`strict: true` in tsconfig)
- No `any` types in new code — use generics or proper interfaces
- All props must have typed interfaces

### Database
- Every tenant-scoped table MUST have `tenantId` + `utils.audit()`
- Use factory functions from `drizzle/schema/utils.ts`
- Add GIN index on any `jsonb` metadata column
- Every migration must have a rollback plan

### API Routes
```
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    // implementation
  } catch (err) {
    return apiError(err); // Never leak err.message
  }
}
```

### Components
- Server components for data fetching
- Client components for interactivity (prefix with `'use client'`)
- Use `Suspense` for async data loading
- Every page needs a `loading.tsx` and `error.tsx`

## Adding a New Feature

1. **Database**: Add schema file → register in `_registry.ts` → create migration
2. **API**: Create route handler → add auth + validation
3. **UI**: Create page → add to sidebar → add loading/error states
4. **Tests**: Add unit tests → integration tests → E2E tests
5. **Docs**: Update API reference at `/tenant/docs`

## Testing Guidelines

```bash
npm test                 # Run all unit + integration tests
npm run test:coverage    # With coverage report
npm run test:e2e         # Playwright E2E tests
```

- Write tests for all new validation schemas
- Test multi-tenant isolation for any new data access
- Coverage threshold: **100% on new lib files**, 70% overall

## Pull Request Process

1. Tests must pass (`npm test`)
2. Coverage must not decrease
3. No `console.log` in production code
4. Add changelog entry
5. Get review from at least one other contributor
