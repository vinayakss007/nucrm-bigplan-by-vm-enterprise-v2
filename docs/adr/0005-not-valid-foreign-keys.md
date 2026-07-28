# ADR-0005: Add foreign keys as `NOT VALID`

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

The revenue chain had no referential integrity at all. 55 tables / 69 FK-shaped
columns lacked `.references()` repo-wide; the worst cluster was the money path:

```
invoices           -> quote_id, order_id, parent_invoice_id
orders             -> quote_id, invoice_id
invoice_line_items -> invoice_id, product_id, service_id
order_line_items   -> order_id, product_id, service_id
invoice_payments   -> invoice_id
```

Deleting a quote orphaned invoices; line items could point at nothing; payments
could attach to nothing.

Adding a validated FK takes an `ACCESS EXCLUSIVE`-style scan of the whole table
and **fails outright** if any existing row violates it. On a live database with
unknown data quality, that is a migration that either locks the table or aborts.

## Decision

Add the constraints in SQL as `NOT VALID`. That binds every new `INSERT` and
`UPDATE` immediately, without scanning existing rows and without failing on
legacy violations. The Drizzle schema declares the same relationships so the
types and tests agree.

`ON DELETE` is chosen per relationship: children `CASCADE` from their own
document (line items die with their invoice), but deleting a _quote_ or a
_product_ is `SET NULL`, so a catalogue change can never cascade into a money
record.

Promote to validated later with `ALTER TABLE ... VALIDATE CONSTRAINT` once the
data is known clean. `VALIDATE` takes only a `SHARE UPDATE EXCLUSIVE` lock and
does not block reads or writes.

## Consequences

- Pre-existing violating rows survive. The constraint is a guarantee about new
  writes only until validated, so `verifyReferentialIntegrity()` is the thing
  that tells you whether the backlog is clean.
- `NOT VALID` constraints are easy to forget about. They are listed in
  `docs/TENANT-ISOLATION-VERIFICATION.md` and the deploy notes so the
  `VALIDATE` step does not get lost.
- Same reasoning applied to `tenant_id` backfills in `0043`: `SET NOT NULL` is
  applied only when the backfill left no gaps, otherwise the migration raises a
  warning with the orphan row count rather than failing the security fix.

## Alternatives considered

- **Validated FKs immediately.** Rejected: unknown production data quality means
  a likely aborted migration, and a full-table scan on the money tables.
- **Application-level integrity checks only.** Rejected: that is the status quo
  that produced orphaned invoices.
- **Clean the data first, then add validated FKs.** Better end state, but it
  cannot be scripted safely without knowing what production contains — and
  meanwhile new writes stay unconstrained. `NOT VALID` stops the bleeding now.
