# NuCRM Enterprise — Audit: Storage, Workers/Queues, Webhooks, Caching (2026-08-27)

**Base:** `main @ c14644eb` · **Scope:** NEW issues only in areas not covered by prior audits
(file upload/storage, background workers & queues, cron idempotency/locking, webhook
idempotency/replay, caching/concurrency, crypto/token handling).
**Method:** architecture trace + targeted static review; **every finding read-verified in source.**
Excludes everything already tracked (SQLi, dep CVEs, pgcrypto migration, RLS/PgBouncer,
workflow-executor IDOR, quote-number, pagination caps, float money math, audit-in-tx).

---

## 🔴 HIGH

### H-A. WhatsApp inbound messages have no idempotency → duplicate rows + inflated counts

- **Where:** `lib/whatsapp/webhook-processor.ts` — inbound insert (~L94) and
  `messageCount` `+ 1` (~L81); `whatsapp_messages.external_id` is a bare `text('external_id')`
  column (`drizzle/schema/comm.ts:44`) with **no unique constraint** (only `0000_init` defines
  the table; no unique index anywhere).
- **Why it happens:** `app/api/webhooks/whatsapp/route.ts` enqueues with **`attempts: 5`**
  (BullMQ retries) and also has an inline fallback that returns **500 so Meta redelivers**. On
  any retry or Meta redelivery, the same inbound `msg.id` is inserted **again** and the
  conversation's `messageCount` is incremented **again** — there is no "row with this external_id
  already exists" check.
- **Impact:** duplicated inbound message records, corrupted conversation threads, and inflated
  message counts feeding analytics/billing.
- **Fix:** add a `UNIQUE (tenant_id, external_id)` index on `whatsapp_messages` and upsert /
  `ON CONFLICT DO NOTHING`; only increment `messageCount` when the insert actually creates a row.

### H-B. WhatsApp status callback updates messages cross-tenant (no tenant filter)

- **Where:** `lib/whatsapp/webhook-processor.ts` (~L123):
  ```ts
  await db.update(whatsappMessages)
    .set({ status, delivered, readAt, ... })
    .where(eq(whatsappMessages.externalId, msgId));   // ONLY predicate
  ```
- **Why it's a leak:** the only filter is `external_id = msgId`. That column has no unique or
  tenant constraint, and the processor runs on the worker's **service DB connection** (no tenant
  context). A delivery/read status callback therefore flips the status of **any tenant's** message
  row that shares that external id. This is a missing **application-level** `tenant_id` filter
  (distinct from the RLS/GUC item), so it stands even where RLS is off.
- **Impact:** one tenant's WhatsApp message state (status/delivered/readAt) can be mutated by
  another tenant's (or a crafted) callback carrying a colliding id.
- **Fix:** scope the update with the conversation's/integration's `tenant_id` (resolve the owning
  tenant from the receiving phone number id, then `and(eq(externalId), eq(tenantId))`).

### H-C. Documents upload accepts arbitrary content types → stored XSS

- **Where:** `app/api/tenant/documents/route.ts` POST (L108–149) takes `mimeType`/`sizeBytes`
  straight from the body with **no MIME allowlist, no extension blocklist, and no size cap**, and
  signs a PUT with that `ContentType`.
- **Contrast:** the sibling `app/api/tenant/documents/upload-url/route.ts` and
  `app/api/tenant/files/route.ts` are carefully hardened (MIME allowlist, blocked
  `.html/.svg/.js/...` extensions, magic-byte sniffing, size limits). This route bypasses all of
  it — a clear regression / inconsistency.
- **Why exploitable:** documents are fetched via a **signed S3 GET URL**
  (`app/api/tenant/documents/[id]/route.ts:48`). An object stored with `Content-Type: text/html`
  (or `image/svg+xml`) opened from that URL **renders inline in the browser**, executing attacker
  script in a first-party-ish context.
- **Impact:** authenticated stored XSS via document upload.
- **Fix:** apply the same allowlist/blocklist/size checks as `upload-url`, and force
  `Content-Disposition: attachment` / a safe `Content-Type` on download for non-previewable types.

### H-D. Documents feature is wired to two different S3 buckets → uploads aren't downloadable

- **Where:**
  - Upload: `app/api/tenant/documents/route.ts` builds its **own** `S3Client` from
    `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` and writes to
    `S3_DOCUMENTS_BUCKET` (default `nucrm-documents`).
  - Download: `app/api/tenant/documents/[id]/route.ts:48` calls `getSignedUrl` from
    `lib/storage/s3`, which resolves credentials/bucket via `getS3Config()` (the
    `S3_ACCESS_KEY`/`S3_ENDPOINT` family) and the **backup** bucket.
- **Impact:** the upload bucket and the download bucket differ, so document downloads point at the
  wrong bucket and fail; the feature is broken end-to-end in any standard config. It also bypasses
  the app's unified, SSRF-aware S3 configuration.
- **Fix:** route both sides through `lib/storage/s3` + `getS3Config()` with a single documents
  bucket.

---

## 🟠 MEDIUM

### M-E. Lead-warming worker sends the WhatsApp message before committing status → double-send on retry

- **Where:** `worker.ts` (~L283–306): the external send to `graph.facebook.com/...messages`
  happens **before** the row is flipped `status='sent'` (matched on `status='queued'`), with no
  send-side dedup key.
- **Impact:** if the DB update fails after a successful send, or the job is retried after the
  network send succeeded, the greeting is sent to the contact **again** (duplicate messages,
  wasted WhatsApp API spend).
- **Fix:** record a provider message id / dedup key and check it before sending, or move to a
  claim-then-send pattern (mark `sending` in a tx, send, then `sent`), tolerating at-most-once.

---

## 🔵 LOW

### L-F. Razorpay webhook has no idempotency / replay guard

- **Where:** `app/api/webhooks/razorpay/route.ts` (~L60–97). Signature verification **is**
  timing-safe and runs before side effects (good), but — unlike Stripe (`acquireLock` on the event
  id) and PayU (`txnid` dedup + `FOR UPDATE`) — there is no event-id dedup and no timestamp/nonce
  check.
- **Impact:** LOW because the handlers are set-to-constant writes (idempotent in effect), but a
  captured `subscription.cancelled` / `payment.failed` event could be replayed to force a tenant to
  `free`/`past_due`.
- **Fix:** add the same `acquireLock('razorpay:evt:{id}')` + timestamp tolerance used by Stripe.

### L-G. Distributed locks fail **open** on Redis outage (by design — flagging the blast radius)

- **Where:** `lib/cache/index.ts` `acquireLock` (~L305) returns `{ acquired: true }` when Redis is
  unavailable. Documented as acceptable (operations are idempotent / have other guards).
- **Impact:** in a memory-only deployment or during a Redis outage, the cron "distributed" locks
  (PR #1493) and the Stripe webhook idempotency provide **no** protection — a double-firing
  scheduler or redelivered event runs twice. Worth an explicit ops note, and a DB advisory-lock
  fallback for the few safety-critical paths.

---

## ✅ Verified CLEAN (no action)

- **All 21 cron routes:** every one verifies `x-cron-secret` with a timing-safe compare
  (`verifySecret`/`verifyCronSecret` → `crypto.timingSafeEqual`), acquires an `acquireLock('cron:…')`
  (PR #1493 applied comprehensively), and scopes per-tenant work correctly.
- **Webhooks:** Stripe (event-id idempotency, timing-safe sig, 500-on-error for retry), PayU
  (`txnid` dedup + `FOR UPDATE` + terminal-status guards), Resend (Svix HMAC over raw body,
  5-minute replay window), Telegram (fail-closed secret, timing-safe), Inbound (API-key auth,
  all handlers tenant-scoped). All signatures are computed over the **raw** request body.
- **BullMQ workers:** handlers wrap work in try/catch and re-throw (failures aren't marked
  complete), tenant-scoped mutations, dedicated Redis connections, graceful shutdown; the memory
  queue adapter throws in production rather than silently dropping jobs.
- **Upload routes** `documents/upload-url` and `files`: MIME allowlist + magic-byte sniffing,
  blocked dangerous extensions, size caps, tenant-scoped random S3 keys, storage-quota enforcement.
- **`lib/crypto.ts`:** `timingSafeEqual`-based secret comparison, no early returns.

---

## Suggested fix order

1. **H-B** WhatsApp cross-tenant status write (add tenant filter) — active isolation gap.
2. **H-C** documents upload MIME allowlist + safe download disposition — stored XSS.
3. **H-A** WhatsApp idempotency (unique index + upsert) — data corruption.
4. **H-D** unify documents S3 config — feature-broken.
5. **M-E** lead-warming send/commit ordering.
6. **L-F / L-G** Razorpay idempotency; document the fail-open lock caveat.
