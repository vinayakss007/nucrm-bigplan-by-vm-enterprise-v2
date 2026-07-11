# NuCRM — Working Plan

## Phase 1: Infrastructure & Environment ✅
- [x] Install Docker + Docker Compose
- [x] Install Node.js 22.22.2 via nvm
- [x] Configure .env.local with Sentry DSN + Auth Token
- [x] Verify local build succeeds (225 routes)
- [ ] Fix Docker build (accept-invite route error)
- [ ] Run full Docker stack (Postgres + Redis + App)
- [ ] Run database migrations
- [ ] Set up admin account

## Phase 2: Critical Bug Fixes
- [ ] Fix Dockerfile — missing .env / build-time env vars
- [ ] Fix middleware.ts deprecation warning
- [ ] Fix `ignoreBuildErrors: true` — should be CI-only
- [ ] Add proper error boundaries across all route groups
- [ ] Add Zod validation on all API inputs
- [ ] Fix all TypeScript `any` types in API routes
- [ ] Ensure all routes use centralized `apiError()`

## Phase 3: Database & Performance
- [ ] Add missing indexes (12 per MASTER_PLAN)
- [ ] Add GIN trigram indexes for full-text search
- [ ] Fix N+1 query patterns
- [ ] Add Redis caching layer
- [ ] Add connection pooling config
- [ ] Optimize dashboard queries (9→2)

## Phase 4: Testing
- [ ] Fix existing unit tests
- [ ] Add integration tests for critical API routes
- [ ] Run Playwright E2E tests
- [ ] Achieve > 80% test coverage

## Phase 5: UI/UX
- [ ] Add skeleton loading states
- [ ] Fix bulk action bar lag
- [ ] Implement data table bulk API integration
- [ ] Add page transitions
- [ ] Keyboard shortcuts on all pages

## Phase 6: Missing Features
- [ ] OpenAPI/Swagger docs
- [ ] Customer Portal improvements
- [ ] Knowledge Base public pages
- [ ] Stripe billing integration

## Phase 7: CI/CD & Deployment
- [ ] Configure GitHub Actions
- [ ] Set up Sentry release tracking
- [ ] Push to GitHub
- [ ] Deploy to production
