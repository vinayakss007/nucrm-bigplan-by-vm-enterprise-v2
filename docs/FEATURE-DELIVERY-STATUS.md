# Feature Delivery Status — What's Built vs. Not Built

**Generated:** 2026-08-29
**Source of truth:** Live GitHub issues (`vinayakss007/nucrm-bigplan-by-vm-enterprise-v2`), verified against the code.

> Purpose of this document: stop overstating. Older tracking files (e.g. `docs/issue-triage.md`,
> `PRE-LAUNCH-ISSUES.md`) carry **stale counts** — for example issue #641's "60/55/78/60" coverage
> numbers, which is where the recurring "55" comes from. That `55` is a **stale branch-coverage
> percentage baked into an old issue body**, not a count of remaining issues. Coverage on `main` is
> already `70/70/80/70` (`vitest.config.ts`).
>
> This file records the **honest** split: features that are **advertised/documented but NOT built**
> (keep open) versus work that is **actually fixed** (closed). It replaces guesswork with the live
> issue state.

---

## Headline numbers (live, verified via `gh api`)

| Metric | Count |
| --- | --- |
| Open issues (excluding PRs) | **51** |
| Closed issues (excluding PRs) | **607** |
| The recurring "55" | **Not an issue count** — it is the stale `functions` coverage % from issue #641; real coverage is 70/70/80/70 |

Do **not** treat "55" as "55 issues left." The real open count is **51**, and several of those are
already-done items pending closure (see the bottom section).

---

## ❌ NOT BUILT — advertised / documented but not functional (keep OPEN)

These came out of the **promise-vs-delivery audit** (merged PR #1628, `fix: close
promise-vs-delivery gaps from the feature audit`). PR #1628 fixed the truly broken pieces and
**softened marketing copy** for the rest; the following capabilities are still genuinely missing and
remain tracked as open feature issues. Each is verified against the file named in its issue body.

| # | Feature | What's missing (verified) |
| --- | --- | --- |
| #1613 | **Built-in e-signature** (`InternalAdapter`) | `lib/esignature.ts` `InternalAdapter` is a stub: `createRequest()` returns a fake externalId, `getStatus()` always returns `'pending'`, `validateWebhook()` always returns `true`, and there is no signer page. Only external DocuSign/HelloSign adapters call real APIs. |
| #1614 | **Scheduled report delivery as PDF / real attachment** | `app/api/cron/scheduled-report-delivery/route.ts` inlines CSV into the email body only. No PDF rendering, no real attachment (the generic `sendEmail` payload has no attachment facility). Cron itself is real. |
| #1630 | **Server-side PDF for quotes & invoices** | `.../quotes/[id]/pdf` and `.../invoices/[id]/pdf` return `text/html` (browser print-to-PDF), not `application/pdf`. No PDF library in the project. Copy softened to "print-ready" in #1628. |
| #1631 | **Recurring-invoice generator** | `drizzle/schema/billing.ts` has `isRecurring` / `recurringFrequency` fields, but **no cron generates the next invoice**. Marketing claim removed in #1628. (Subscriptions + renewal reminders are real.) |
| #1632 | **Multi-step approval chains** | Approvals only support single-stage approve/reject (`approvedBy`/`rejectedBy`). No steps / approvers[] / currentStep. Copy corrected to "approval requests" in #1628. |
| #1633 | **Segment dynamic membership + sequence sync** | Segments CRUD was delivered in #1628, but nothing evaluates `segments.config` filters into a live member list, and no code enrols segment members into drip sequences. |
| #1119 | **Keyboard shortcuts** | Documented in `components/shared/shortcuts-modal.tsx` (`G D`, `N C`, `Cmd+S`, `Cmd+E`, `Cmd+/`) but not implemented. Only `?` and `Cmd+K` work. |
| #1083 | **Lead filters (source / assigned_to / lifecycle / tags / score)** | Data is tracked but no UI filter controls exist in `components/tenant/leads-client-new.tsx`. |

**Rule going forward:** if a capability in this table is not shipped end-to-end, the marketing/landing
copy and in-app text must not claim it. Either build it (close the issue) or keep the softened copy.

---

## ✅ FIXED / CLOSED — do not re-report as open

Representative recently-closed items (of **607** closed total). These are done — treat any doc that
still lists them as "open" as stale.

| # | Item |
| --- | --- |
| #1615 | Postgres RLS non-functional in default deploy — fixed |
| #1628 (PR) | Promise-vs-delivery gaps: **Segments CRUD** added, plus copy corrections — merged |
| #1611 | Quote number `COUNT(*)+1` collision — fixed (concurrency-safe) |
| #1612 | Uncapped/negative pagination params — fixed |
| #1194 | Services page modal hardcoded colors / dark mode — fixed |
| #1338 / #1339 | Missing `loading.tsx` / `error.tsx` routes — fixed |
| #1114 | Native confirm/prompt/alert replaced with themed components — fixed |
| #1255 | No distributed locks on 16 of 21 cron jobs — fixed |
| #1325 | Bulk email sent sequentially instead of queued — fixed |
| #641 (coverage) | Coverage threshold already `70/70/80/70` on `main` — the source of the stale "55" |

---

## ⚠️ Stale docs to trust with caution

The following contain **out-of-date counts** and should be read alongside the live issue list, not
as authority:

- `docs/issue-triage.md` — "20 open issues" and the "60/55/78/60" numbers are stale (live open = 51).
- `PRE-LAUNCH-ISSUES.md` — dated 2026-07-31; several referenced issues are now closed.
- `docs/planning/*` — historical snapshots; keep for archaeology, not for current status.

For the current picture always run:

```bash
gh api "repos/vinayakss007/nucrm-bigplan-by-vm-enterprise-v2/issues?state=open&per_page=100" \
  --paginate --jq '.[] | select(.pull_request == null) | "#\(.number) \(.title)"'
```
