# NuCRM Enterprise — Security & Quality Audit Report

**Audit date:** 2026-08-23
**Audited HEAD:** main @ `6771cea0`
**Method:** Live verification — full typecheck, full unit suite (5,518 tests), npm audit, route-by-route tenant-scoping sweep, rate-limit coverage scan, RLS/migration review.

**Scale audited:** 1,557 TS files · 211K LOC · 484 API routes · 67 migrations · 12 docs

---

## Overall Grade: B+ (trending A− after pending PRs merge)

| #   | Aspect           | Grade  | Key Evidence                                                                                                                |
| --- | ---------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | Type Safety      | **A**  | `tsc --noEmit` = 0 errors across 211K LOC (strict mode)                                                                     |
| 2   | Testing          | **B+** | 5,490 passed / 14 failed (pre-existing, documented) / 14 skipped                                                            |
| 3   | Security Posture | **B+** | Tenant isolation pervasive; RLS; hash-chained audit; RL near-complete. Gaps: CSP unsafe-inline, POST-route limits           |
| 4   | Dependencies     | **C+** | 41 vulnerabilities — **4 CRITICAL** (libvips/sharp), 12 high, 24 moderate                                                   |
| 5   | CI/CD            | **B+** | 6-stage pipeline + health-gated rollback deploy. Gaps: semgrep SARIF path bug, CodeQL v3 deprecation, branch protection off |
| 6   | Database         | **B**  | 67 migrations, FK/index fixes landed. Risks: journal duplicates (#10), RLS-per-table coverage unverified                    |
| 7   | Code Hygiene     | **A−** | Silent catches down 23→1; consistent structure                                                                              |
| 8   | Documentation    | **A−** | 12 substantial docs; PRE-LAUNCH-ISSUES.md stale                                                                             |
| 9   | Ops Readiness    | **B**  | pm2/nginx deploy, monitoring stack. Open: Grafana default creds, no DB TLS                                                  |

---

## OPEN ISSUES (consolidated, verified status as of audit date)

### 🔴 CRITICAL

#### C1. Dependency vulnerabilities — 4 critical / 12 high

- `sharp` → libvips CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591 (GHSA-f88m-g3jw-g9cj)
- Total: 41 vulns (1 low, 24 moderate, 12 high, 4 critical)
- **Fix:** bump sharp/libvips, then `npm audit fix` round; re-run CI.
- Effort: ~30–60 min

#### C2. Cross-tenant AI summarize leak — FIXED, awaiting merge ✅

- `lib/ai/summarize.ts` fetched contact/deal/company by id with no tenant filter.
- **Fix shipped:** PR #1414 (+ regression tests). Merge it.

#### C3. SQL injection surface — FIXED, MERGED ✅

- `sql.raw()` eliminated in data-explorer + reports/builder; PUT field allowlist added (PR #1412, merged).

#### C4. Rate limiting on mutating endpoints — 7 routes fixed pending merge; POST gap remains

- PATCH/PUT/DELETE: last 7 routes guarded in PR #1416 (helper now accepts `put`). Merge it.
- **Remaining:** ~66 POST-only handlers without limits (many are read-via-POST/search/webhook style) — needs per-case limit tuning. Effort: 1–2 days.

---

### 🟠 HIGH

#### H1. CSP `unsafe-inline` for scripts (Issue #657)

- Production script-src still allows inline scripts (Next hydration constraint).
- Two competing branches exist: `fix/csp-tightening-object-src` (PR #1418 — object-src/base-uri/frame-src/worker-src, keeps frame-ancestors 'none') vs `fix/csp-hardening` (adds base-uri but WEAKENS frame-ancestors to 'self', loosens img-src to https:).
- **Decision needed:** merge one, drop the other (recommend keeping 'none' + tighter set from PR #1418), then plan nonce strategy via proxy.ts middleware. Requires hydration verification.

#### H2. Optimistic concurrency guards not universal (Issue #680)

- Only contacts PATCH has updatedAt guard consistently. Deals/tasks/companies/etc. can lose updates.
- Effort: 3–5 days, phased.

#### H3. 36 multi-table writes outside `db.transaction()` (Issue #685)

- Batch 1 merged; remainder can leave partial writes on failure.
- Effort: 3–5 days, phased.

#### H4. Migration journal duplicates/gaps (Issue #682)

- `_journal.json` has duplicate index entries and gaps → fresh-DB bootstrap risk.
- ⚠️ Contested file right now (batch-6 edited it); coordinate before editing.
- Effort: 1 day + fresh-bootstrap test run.

---

### 🟡 MEDIUM

#### M1. Stale tracking docs mislead contributors

- `PRE-LAUNCH-ISSUES.md` (dated 2026-07-31) is ~50% already fixed (verified this audit): C2 contacts-leak, session invalidation, audit filters, deals stage_name resolution, most of rate limiting.
- `ISSUES.md` infra list partially stale too (CI now exists).
- **Fix:** mark resolved sections with status + date, or archive into `docs/archive/`.

#### M2. CI workflow hygiene

- Semgrep step fails on missing `semgrep.sarif` path handling (seen on PR runs).
- CodeQL action v3 → v4 before Dec 2026 deprecation.
- Node 20 target deprecation warnings on pinned actions.

#### M3. 75 stub test assertions (`expect(true).toBe(true)`) (Issue #667)

- False confidence in coverage numbers. Effort: 2–3 days.

#### M4. Silent error swallowing

- Down to 1 instance (from ~23). Find & fix the straggler.

#### M5. Missing API route tests for security-critical paths (Issue #666)

- Tenant-isolation tests especially. Effort: 5+ days.

---

### 🔵 LOW / OPERATIONAL

#### O1. Enable branch protection on `main` ⚠️ owner action required

- Policy is "never push to main," but protection API returned 403 (token scope).
- **Owner:** Settings → Branches → Add rule for `main`: require PR, dismiss stale approvals; enforce for admins; block force pushes.

#### O2. PostgreSQL without TLS (sslmode=disable everywhere)

- MITM exposure between app and DB; compliance blocker (SOC2/GDPR).
- Fix: enable SSL in postgresql.conf, sslmode=require, PgBouncer TLS.

#### O3. Grafana default admin credentials

- Generate strong password via deploy/generate-secrets.sh; restrict datasource to read-only user.

#### O4. Multiple conflicting DB passwords across configs

- Consolidate to env-var-only; rotate all; single source via generate-secrets.sh.

#### O5. Prometheus/Grafana only reachable via SSH tunnel

- Document tunnel usage or add Cloudflare Tunnel/Tailscale for team access.

#### O6. No Infrastructure-as-Code for VM provisioning

- Minimum viable: Terraform (Hetzner/DO) + cloud-init for Docker setup.

#### O7. Actions runner quota pressure

- Private-repo minutes exhausted mid-day during parallel agent waves; runs queued indefinitely. Monitor billing or prune workflow triggers.

---

## VERIFIED-FIXED DURING THIS AUDIT (do not re-fix)

- Contacts page cross-tenant leak (all 15 contacts routes + pages + services scoped) ✔
- Session invalidation on role change (`isCachedContextStillAuthorized` w/ roleSlug check) ✔ — residual: in-place role permission edits need version stamp (schema change, deferred)
- Audit log tenant filtering (hash-chained, fully scoped) ✔
- Deals `stage_name` resolution (robust fallback chain in place) ✔
- Windows/macOS install broken by linux-only rolldown binding (moved to optionalDependencies) ✔

## PENDING PRs FROM THIS AUDIT (merge queue)

| PR    | Content                                                | CI                             |
| ----- | ------------------------------------------------------ | ------------------------------ |
| #1414 | AI summarize tenant scoping + regression tests         | re-running after test-mock fix |
| #1416 | Rate-limit final 7 mutating routes                     | all green                      |
| #1418 | CSP tightening (coordinate w/ fix/csp-hardening first) | all green                      |

## RECOMMENDED ORDER

1. Merge #1416 + #1418 (after CSP coordination) + #1414 when green
2. C1 dependency bumps (critical CVEs)
3. H4 migration journal (coordinate with active agents)
4. H1 nonce-CSP decision + implementation
5. H2/H3 phased transaction & concurrency work
6. O1 branch protection (owner, 2 minutes)
7. O2/O3 TLS + Grafana creds before public launch
