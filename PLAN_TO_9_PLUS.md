# NuCRM — Upgrade Plan: All Departments → 9/10, Core → 9.9/10

**Current Overall:** 7.9/10  
**Target:** 9.0/10 overall, 9.9/10 for Core Foundation

---

## Phase 0: Infrastructure Blockers (unblocks everything)

These are the critical paths blocking all other work. Fix these first.

### 0.1 TypeScript type-check timeout
**Current:** `tsc --noEmit` hangs/timeout  
**Action:** Identify the slow file/s that cause `tsc` to hang. Run `tsc --noEmit --diagnostics` with increased memory. Typically caused by circular type references in Drizzle schema or large barrel exports.  
**Fix:** Break circular deps in `_registry.ts`, add `tsc --noEmit` to pre-commit hook with 120s timeout.

### 0.2 Build timeout
**Current:** `next build` hangs  
**Action:** Check for unoptimized imports, large `node_modules` from barrel exports. Add `experimental.serverComponentsExternalPackages` in `next.config.mjs`.  
**Fix:** Optimize build pipeline, enable `output: 'standalone'` with proper tracing.

### 0.3 Migration application
**Current:** 25 SQL migration files but RLS and other migrations are NOT applied to the database  
**Action:** Run `npm run db:migrate` to apply all pending migrations.  
**Fix:** Apply migration #0012 (RLS), #0016 (RLS fix), and any other pending.

---

## Phase 1: Security — RLS for all tenant-scoped tables (Critical)

**Current Score: 0/10 → Target: 9/10**  
**Impact:** This single fix raises Security from 8 to 9+ AND Core from 9 to 9.9

### Tasks:
1. **Extend RLS migration to ALL 170+ tenant-scoped tables**
   - Read `_registry.ts` to get all tables with `hasTenantId: true`
   - Generate migration SQL dynamically: `ALTER TABLE %I ENABLE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON %I ...`
   - Create migration `0036_enable_rls_all_tenant_tables.sql`
   - Apply via `npm run db:migrate`

2. **Write RLS-enablement test**
   - Expand `tests/integration/tenant-isolation.test.ts` to verify ALL tenant tables have RLS
   - Test: attempt cross-tenant data access, verify it's blocked
   - Test: verify `app.current_tenant` session variable is properly set by middleware

3. **Verify RLS middleware chain**
   - Ensure `requireAuth()` sets `app.current_tenant` on every request
   - Add test in `tests/unit/auth-middleware.test.ts`
   - Verify superadmin can bypass RLS

### Estimated effort: 2-3 days

---

## Phase 2: Core Foundation → 9.9/10

**Current: 9/10 | Gaps: RLS, edge-case tests**

### 2.1 RLS on core tables (tenants, users, roles, sessions)
- Enable RLS on tenant-scoped core tables
- Test that tenant members can only see their own tenant's data
- Test that superadmin sees all tenants

### 2.2 Edge case tests for auth
- Add tests for: token expiry, refresh token rotation, concurrent sessions, password policy enforcement
- Add TOTP/2FA flow tests
- Add SSO login flow tests (SAML/OIDC)
- Add impersonation audit trail tests

### 2.3 API key lifecycle
- Add tests for API key rotation, revocation, expiry
- Add tests for key usage quota enforcement
- Add tests for key-scoped permission boundaries

### Estimated effort: 3-4 days

---

## Phase 3: Support/Tickets → 9/10

**Current: 7/10 | Gaps: SLA integration, escalation**

### 3.1 SLA breach detection
- Add tests: SLA policy creation → ticket creation → SLA timer starts → breach triggers notification
- Test SLA pause/resume scenarios
- Test SLA exclusion rules (weekends, holidays)

### 3.2 Escalation matrix
- Add tests: escalation rules by priority → auto-assign → notification chain
- Test multi-level escalation with timeouts
- Test escalation override/cancel

### 3.3 Ticket lifecycle
- Add tests: status transitions, assignment, priority changes
- Add tests: conversation threading, attachments in replies
- Add tests: CSAT/satisfaction surveys

### Estimated effort: 3-4 days

---

## Phase 4: Marketing/Sequences → 9/10

**Current: 7/10 | Gaps: A/B testing, campaign analytics**

### 4.1 A/B testing framework
- Add `campaign_variants` table or extend sequences with variant support
- Add tests: random variant assignment → open/click tracking per variant → statistical significance
- Add tests: variant winner auto-promotion

### 4.2 Campaign analytics
- Create materialized view `campaign_performance_mv` with: sends, opens, clicks, replies, bounces, conversions
- Add refresh schedule (cron job)
- Add tests: view data correctness after sequence step execution

### 4.3 Sequence optimization
- Add tests: optimal send time detection
- Add tests: engagement-based branching (high-engagement → longer sequence, low-engagement → re-engagement)
- Add tests: unsubscribe handling across sequences

### Estimated effort: 4-5 days

---

## Phase 5: Documents/Storage → 9/10

**Current: 7/10 | Gaps: S3 integration tests**

### 5.1 S3 storage integration
- Add tests: file upload → S3 putObject → returns signed URL
- Add tests: file download → S3 getObject → stream to client
- Add tests: file delete → S3 removeObject → cleanup metadata
- Add tests: large file handling (multipart upload)
- Add tests: S3 error handling (network failure, permission denied, bucket not found)

### 5.2 Document versioning
- Add `document_versions` table or version fields
- Add tests: version creation, rollback, diff
- Add tests: version retention policy enforcement

### 5.3 Document preview/thumbnails
- Add tests: thumbnail generation pipeline
- Add tests: supported MIME type detection

### Estimated effort: 3-4 days

---

## Phase 6: Analytics & Views → 9/10

**Current: 6/10 | Gaps: Materialized views, performance**

### 6.1 Materialized views for performance
- Create `deals_pipeline_summary_mv` — pipeline stage counts, amounts, weighted forecasts
- Create `revenue_dashboard_mv` — daily/monthly revenue, MRR/ARR, churn
- Create `contact_engagement_mv` — last activity, open rates, response times
- Create `team_performance_mv` — per-user metrics (deals closed, tasks completed, calls made)

### 6.2 View refresh pipeline
- Add cron-based refresh with `REFRESH MATERIALIZED VIEW CONCURRENTLY`
- Add tests: view correctly reflects underlying data changes
- Add tests: concurrent refresh doesn't block reads

### 6.3 Report builder tests
- Expand `tests/unit/report-builder-api.test.ts` with more report types
- Add tests: custom date ranges, filters, aggregations
- Add tests: scheduled report delivery (email, Slack)

### Estimated effort: 4-5 days

---

## Phase 7: Projects → 9/10

**Current: 6/10 | Gaps: Gantt, resource management**

### 7.1 Gantt chart support
- Add `task_dependencies` table (predecessor/successor with lag time)
- Add tests: dependency chain validation, cycle detection
- Add tests: critical path calculation

### 7.2 Resource management
- Add `resource_allocations` table (user → project → hours)
- Add tests: over-allocation detection, availability calculation
- Add tests: time tracking and billing integration

### 7.3 Project reporting
- Create materialized view `project_health_mv` (progress %, budget burn, milestone completion)
- Add tests: earned value management (EVM) calculations

### Estimated effort: 4-5 days

---

## Phase 8: E-Signature & Email Tracking → 9/10

**Current: 7/10 | Gaps: Webhook verification, audit trails**

### 8.1 Webhook callback verification
- Add tests: signature verification for DocuSign/Adobe Sign webhooks
- Add tests: idempotent webhook processing (duplicate detection)
- Add tests: webhook failure → retry → dead letter queue

### 8.2 Audit trail for signatures
- Add tests: complete audit log for signing ceremony (send → view → sign → complete)
- Add tests: certificate of completion generation

### 8.3 Email tracking accuracy
- Add tests: open pixel tracking (unique opens, device detection)
- Add tests: click tracking (redirect preservation, link rewriting)
- Add tests: bounce classification (hard, soft, auto-reply)
- Add tests: privacy/GDPR compliance (opt-out, pixel blocking)

### Estimated effort: 3-4 days

---

## Phase 9: Compliance & SLA → 9/10

**Current: 7/10 | Gaps: Automated enforcement**

### 9.1 Automated compliance enforcement
- Add tests: data retention policy → automatic purge on expiry
- Add tests: GDPR right-to-erasure → cascade delete across all tenant tables
- Add tests: GDPR data portability → export all user data in standard format
- Add tests: SOC2 audit log immutability (hash chain verification)

### 9.2 Compliance reporting
- Add tests: compliance status dashboard data accuracy
- Add tests: scheduled compliance report generation

### Estimated effort: 3-4 days

---

## Phase 10: Integration Tests & Coverage → 9/10

**Current: 40% coverage threshold | Target: 60%+**

### 10.1 Raise coverage thresholds in vitest.config.ts
```
lines: 60 (from 40)
functions: 65 (from 45)
branches: 55 (from 35)
statements: 60 (from 40)
```

### 10.2 Add integration tests for critical business flows
- Complete deal lifecycle: lead → contact → deal → quote → invoice → payment
- Complete onboarding: signup → tenant creation → module selection → first use
- Complete backup/restore: backup → selective restore → integrity verification

### 10.3 Add E2E tests
- Login flow (success, failure, reset password, 2FA)
- Deal creation → pipeline stage movement → won/lost
- Contact import → deduplication → merge
- Email sequence → enrollment → step execution → completion

### Estimated effort: 5-7 days

---

## Phase 11: Performance & Load Testing → 9/10

**Current: Basic load tests exist | Target: Production-grade**

### 11.1 Benchmark current performance
- Run `tests/load/baseline.js` and `tests/load/write-heavy.js`
- Establish P50/P95/P99 latency baselines
- Identify slow queries via pg_stat_statements

### 11.2 Query optimization
- Create missing indexes based on slow query analysis
- Add composite indexes for common query patterns
- Add partial indexes for soft-delete filtering (`WHERE deleted_at IS NULL`)

### 11.3 Connection pooling
- Configure PgBouncer for connection pooling
- Add tests: connection storm handling, pool exhaustion recovery

### Estimated effort: 3-5 days

---

## Summary Timeline

| Phase | Effort | Priority | Score Boost |
|---|---|---|---|
| 0. Infrastructure blockers | 1-2 days | 🚨 **Critical** | Unblocks everything |
| 1. RLS for all tenant tables | 2-3 days | 🚨 **Critical** | 0→9 (Security) |
| 2. Core Foundation → 9.9 | 3-4 days | 🔴 High | 9→9.9 |
| 3. Support/Tickets → 9 | 3-4 days | 🟡 Medium | 7→9 |
| 4. Marketing → 9 | 4-5 days | 🟡 Medium | 7→9 |
| 5. Documents → 9 | 3-4 days | 🟡 Medium | 7→9 |
| 6. Analytics/Views → 9 | 4-5 days | 🟡 Medium | 6→9 |
| 7. Projects → 9 | 4-5 days | 🟡 Medium | 6→9 |
| 8. E-Signature → 9 | 3-4 days | 🟢 Low | 7→9 |
| 9. Compliance → 9 | 3-4 days | 🟢 Low | 7→9 |
| 10. Coverage/Integration | 5-7 days | 🟡 Medium | 7→9 |
| 11. Performance/Load | 3-5 days | 🟢 Low | 7→9 |

**Total estimated effort: 38-54 days**  
**Parallelizable:** Phases 3-9 can run in parallel after Phase 1-2 complete.

---

## Department Score Matrix After Plan

| Department | Before | After |
|---|---|---|
| Core Foundation | 9.0 | **9.9** |
| CRM | 9.0 | 9.5 |
| Communication | 9.0 | 9.5 |
| Automation | 9.0 | 9.5 |
| Infrastructure | 8.0 | 9.0 |
| AI Engine | 9.0 | 9.5 |
| Billing/Financial | 9.0 | 9.5 |
| Security/Tokens | 8.0 | **9.5** |
| Support/Tickets | 7.0 | **9.0** |
| Marketing | 7.0 | **9.0** |
| Documents/Storage | 7.0 | **9.0** |
| Analytics/Views | 6.0 | **9.0** |
| Lead Warming | 8.0 | 9.0 |
| Projects | 6.0 | **9.0** |
| Compliance/SLA | 7.0 | **9.0** |
| Hierarchy/Territories | 7.0 | 9.0 |
| Modules/Plugins | 8.0 | 9.0 |
| E-Signature | 7.0 | **9.0** |
| **Overall** | **7.9** | **9.3** |
