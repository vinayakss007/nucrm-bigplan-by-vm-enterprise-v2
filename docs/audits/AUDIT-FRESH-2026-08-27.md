# NuCRM Enterprise — Fresh Pre-Launch Audit (2026-08-27)

**Method:** Live tooling run against the current working tree, not a re-read of prior docs.
Installed deps (`npm ci`), then ran `npm audit`, `tsc --noEmit`, `eslint .`, and the full
`vitest` unit/dashboard/integration suites. Plus targeted static scans for SQLi, empty catches,
hardcoded secrets, TLS bypass, and pool/SSL wiring.

**Scope:** 1,505 TS/TSX source files · 484 API routes · 139 SQL migrations · Next.js 16.3.3 / React 19.

---

## TL;DR — what is actually green vs. red right now

| Check                            | Result                                      | Notes                                         |
| -------------------------------- | ------------------------------------------- | --------------------------------------------- |
| `tsc --noEmit`                   | ✅ 0 errors                                 | Strict mode clean across the whole tree       |
| `eslint .`                       | ✅ 0 errors                                 | 152 warnings (see LOW-1)                      |
| Unit + dashboard tests           | ✅ 5,309 passed / 0 failed (318 files)      | Previously-documented failing tests are fixed |
| Integration tests                | ❌ **5 failed** / 204 passed / 21 skipped   | See HIGH-2                                    |
| `npm audit` (prod deps)          | ❌ **30 vulns: 7 high, 22 moderate, 1 low** | See CRIT-1 / HIGH-1                           |
| `sql.raw()` sites                | ✅ none                                     | Old SQLi surface fully removed                |
| Hardcoded secrets in source      | ✅ none                                     | Only env-var mappings + seed UUIDs            |
| `@ts-ignore` / `NODE_TLS_REJECT` | ✅ none in prod code                        | —                                             |

The good news: the big-ticket items from the old docs (SQLi via `sql.raw`, contacts
cross-tenant leak, type errors, most failing tests) are genuinely fixed. The issues below
are the ones that are **still real on `main` today** and several are **not** in the existing
tracking docs.

---

## CRITICAL

### CRIT-1. `dompurify` has a HIGH-severity XSS advisory — and it is the app's only XSS defense

- **Evidence:** `npm audit` flags `dompurify` (GHSA — "XSS via `selectedcontent` re-clone").
- **Why it's critical here:** `lib/sanitize.ts` wraps DOMPurify and is the sanitizer behind
  **every** `dangerouslySetInnerHTML` in the app — email templates
  (`app/tenant/email-templates/page.tsx`), the email block renderer
  (`components/tenant/email-builder/block-renderer.tsx`), TOTP QR SVG rendering, etc.
  A bypass in DOMPurify is a direct stored-XSS path through user-authored email HTML.
- **Fix:** bump `dompurify` to the patched release, re-run `npm audit`, and add a regression
  test that feeds the advisory's payload through `sanitizeHTML()`.

### CRIT-2. Two backup DB pools connect WITHOUT the SSL hardening every other pool uses

- **Evidence:**
  - `app/api/cron/auto-backup/route.ts:45` → `new Pool({ connectionString: process.env.DATABASE_URL })`
  - `app/api/cron/backup-verify/route.ts:116` and `:208` → `new Pool({ connectionString: ... })`
  - None of these pass an `ssl` option, so they **bypass `lib/db/ssl-config.ts` (`pgSslConfig`)**
    which `lib/db/pool.ts` and `lib/db/read-replica.ts` correctly use.
- **Impact:** The recently-added "SSL on by default / verify cert in production" behavior does
  **not** apply to the two code paths that move the entire database over the wire (full dumps +
  restore-verify). If the network path isn't otherwise encrypted, backups transit in plaintext.
  This is a real inconsistency and is **not** captured in the existing "no DB TLS" ops note.
- **Fix:** import `pgSslConfig` and pass `ssl: pgSslConfig(process.env)` in all three `new Pool`
  calls in these two files (and audit the `scripts/*` pools, which also build their own pools).

---

## HIGH

### HIGH-1. Production dependency vulnerabilities (7 high), including one with NO fix available

| Package           | Installed  | Severity          | Advisory summary                                                                          |
| ----------------- | ---------- | ----------------- | ----------------------------------------------------------------------------------------- |
| `dompurify`       | (nested)   | high              | XSS (see CRIT-1)                                                                          |
| `nodemailer`      | 8.0.9      | high              | `raw` option bypasses `disableFileAccess`/`disableUrlAccess` → arbitrary file read + SSRF |
| `xlsx`            | 0.18.5     | high              | Prototype pollution + ReDoS — **no fixed version published**                              |
| `mathjs`          | 14.9.1     | high              | Unsafe object property setter (prototype pollution)                                       |
| `js-yaml`         | 4.1.1      | high (transitive) | Quadratic-complexity DoS via merge-key aliases                                            |
| `brace-expansion` | transitive | high              | DoS via large numeric range                                                               |
| `fast-uri`        | transitive | high              | Host confusion via backslash authority delimiter                                          |

- **`nodemailer` / `mathjs`** have fixes but they are major-version bumps (`nodemailer@9`,
  `mathjs@15`) → need code-compat review, not a blind `audit fix --force`.
- **`xlsx`** has no upstream fix. Options: pin + restrict to trusted input only, move to the
  maintained `xlsx` distribution from SheetJS's CDN, or replace with `exceljs`. Since XLSX is
  used for user-facing import/export, prototype-pollution on parse is a real risk.
- **Fix order:** dompurify → nodemailer → mathjs → transitive (`npm audit fix`) → xlsx decision.

### HIGH-2. Integration test suite is RED — 5 failures block CI

- **Command:** `npm run test:integration` → 5 failed / 204 passed / 21 skipped.
- **Root cause (single):** every failure throws `Environment validation failed: ENCRYPTION_KEY
is required for backup encryption`. The fixtures in
  `tests/integration/critical-coverage.test.ts` (~line 537/544) and
  `tests/integration/vulnerability-security.test.ts` (~line 545) construct a "valid" env but
  omit `ENCRYPTION_KEY` (and `SESSION_SECRET`), which `lib/env.ts:validateEnv()` now requires.
- **Why it matters:** (a) CI is red, so this suite gives no signal; (b) the
  `vulnerability-security.test.ts` case is literally named "validates required secrets are
  present" and it can no longer validate anything — it just crashes. These are stale fixtures,
  not a prod-code bug, but they must be fixed before launch or the security suite is worthless.
- **Fix:** add `ENCRYPTION_KEY` (≥32 chars) and `SESSION_SECRET` to those fixtures; consider a
  shared `makeValidEnv()` helper so new required vars don't silently break these again.

---

## MEDIUM

### MED-1. `react-hooks/exhaustive-deps` warnings in 3 production client components

- **Locations:** `app/tenant/analytics/analytics-client.tsx:32-33`,
  `app/tenant/analytics/forecast/forecast-client.tsx:34`,
  `app/tenant/notifications/page.tsx:49`.
- **Risk:** missing effect dependencies are a classic source of **stale-closure bugs** — charts
  that don't refetch on filter change, notifications that read a stale token, etc. These render
  correctly in tests but misbehave with real user interaction. Worth a manual review of each.

### MED-2. `console.log` in 14 API route files

- **Evidence:** 14 files under `app/api/**` still use `console.log(`.
- **Risk:** unstructured logging can leak PII into stdout/log aggregation and bypasses the
  Sentry PII-scrub pipeline (`sentry-pii-scrub.ts`). Convert to the structured logger and gate
  behind non-production.

---

## LOW

### LOW-1. 152 ESLint warnings

- 94 `@typescript-eslint/no-explicit-any` (mostly in `tests/**`), 47 `unused-imports/no-unused-vars`,
  11 `react-hooks/exhaustive-deps` (the prod ones are MED-1). Not launch-blocking, but the
  `any` usages in SDK/test code erode the "0 type errors" guarantee at the test boundary.

### LOW-2. Three lockfiles committed (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`)

- Ambiguous install source; different CI/dev machines can resolve different trees. Pick one
  package manager and delete the other two lockfiles.

---

## Verified fixed since the old docs (do NOT re-fix)

- `sql.raw()` SQL-injection surface — **gone** (0 call sites).
- TypeScript errors — **0** across 211K LOC.
- Unit/dashboard failing tests (contact-timeline, saved-reports, pipelines-stage-safety) — **pass**.
- Empty `catch {}` blocks — only 2 benign fire-and-forget analytics pings in
  `app/api/embed/form.js/route.ts`.
- Hardcoded secrets — none in source.
- sharp/libvips CRITICAL CVEs from the 2026-08-23 audit — no longer present.

## Recommended launch order

1. **CRIT-1** dompurify bump (+ regression test) — small, high payoff.
2. **CRIT-2** SSL on the 3 backup pools — a few lines, closes a plaintext-DB path.
3. **HIGH-2** fix the 5 integration fixtures — unblocks the security test suite.
4. **HIGH-1** nodemailer/mathjs bumps with compat review; make the xlsx decision.
5. **MED-1/MED-2** hook deps + logging hygiene.
6. **LOW-2** collapse to a single lockfile.
