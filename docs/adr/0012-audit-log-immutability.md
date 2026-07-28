# ADR-0012: Enforce audit-log immutability in the database

**Status:** Accepted
**Date:** 2026-07-28
**Issue:** #676 (principle 2 — immutable audit chain)

## Context

Migration `0009` added `previous_hash` and `hash` to `audit_logs`, and its own
column comment claims they form "an immutable chain". Nothing enforced that.

A hash chain makes tampering **detectable**, not **impossible** — and only if
someone runs the verifier. An `UPDATE` or `DELETE` from a stray migration, a
mistaken `psql` session, or a compromised application credential could rewrite
history and re-link the chain so verification still passed.

`app/api/superadmin/data-explorer` performs arbitrary `UPDATE`/`DELETE` against a
table allowlist. `audit_logs` is not on that allowlist today — but that is one
list edit away from being the tamper path.

## Decision

Enforce append-only at the database, with `BEFORE UPDATE` / `BEFORE DELETE`
triggers on `audit_logs` and `super_admin_audit_logs` (migration `0048`).

- **`UPDATE` is always refused.** There is no legitimate reason to alter a written
  audit entry, so there is no escape hatch.
- **`DELETE` is refused unless the transaction opts in:**
  ```sql
  SET LOCAL app.allow_audit_purge = 'on';
  ```

### Why DELETE has an escape hatch and UPDATE does not

Blocking `DELETE` outright would make lawful retention impossible. GDPR erasure
requests and finite retention windows both require eventually removing old audit
rows; a system that cannot delete them cannot comply.

The hatch is deliberately **transaction-scoped** (`SET LOCAL`, not `SET`) so it
cannot leak into another request through a pooled connection — the same hazard
ADR-0003 dealt with for the tenant GUC. Its purpose is not to add security but to
convert _silent, accidental_ deletion into a _deliberate, greppable_ act.

### Alternatives rejected

- **Rely on the hash chain alone.** Rejected: detection after the fact is not
  prevention, and it only works if the verifier is run.
- **`REVOKE UPDATE, DELETE` from the app role.** Better in principle, but the app
  currently connects as the table owner, and owners bypass such grants. That needs
  the non-owner role split (ADR-0003) first; these triggers work today and will
  still hold afterwards, since triggers apply to the owner too.
- **Soft-delete audit rows instead (`deleted_at`).** Rejected: a soft delete is an
  `UPDATE`, which is precisely the operation that must be impossible. It would
  also leave "deleted" audit rows indistinguishable from tampered ones.

## Consequences

- Any code path that updates or deletes an audit row now fails loudly with a
  `check_violation`. Verified that no application code does: there are no
  `update(auditLogs)` / `delete(auditLogs)` call sites and no raw SQL equivalents.
- A retention job must be written to set `app.allow_audit_purge` explicitly. None
  exists yet; when one is added, that line is the audit trail for why rows went.
- The triggers add one `plpgsql` invocation per attempted mutation — effectively
  zero cost, since the only mutations are the ones being blocked. `INSERT` is
  untouched and unaffected.

## Verification

Against real PostgreSQL 16:

| Check                                                | Result                                     |
| ---------------------------------------------------- | ------------------------------------------ |
| `INSERT`                                             | allowed (append-only, not read-only)       |
| `UPDATE`                                             | **refused**                                |
| `UPDATE` with purge flag set                         | **still refused**                          |
| `DELETE` (default)                                   | **refused**                                |
| `DELETE` with `SET LOCAL app.allow_audit_purge='on'` | allowed                                    |
| `DELETE` in the next transaction                     | **refused again** (flag did not leak)      |
| `super_admin_audit_logs` `UPDATE`                    | **refused**                                |
| Rollback migration                                   | triggers removed, `UPDATE` permitted again |
