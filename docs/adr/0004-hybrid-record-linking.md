# ADR-0004: FK columns for domain-core relationships, `record_links` for the rest

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

The domain was siloed in ways that made ordinary questions unanswerable:

- `tasks` linked only `contact_id` and `deal_id` — no company, lead, ticket or project.
- `support_tickets` linked only `contact_id`, so "all tickets for this company" had no answer.
- `activities` carried _both_ a polymorphic `entity_type`/`entity_id` pair _and_
  denormalised FK columns, and had no `lead_id`.
- `quotes` had no `company_id` while invoices, orders and contracts did.
- `invoices` had no `deal_id`, so deal → quote → invoice revenue attribution broke.

## Decision

A hybrid, matching what Salesforce and HubSpot converged on:

- **Real FK columns** for the domain core, where the relationship is part of the
  entity's identity and needs referential integrity and cheap joins:
  `tasks.company_id/lead_id/ticket_id`, `support_tickets.company_id/deal_id/lead_id`,
  `activities.lead_id`, `quotes.company_id`, `invoices.deal_id`. All indexed on
  `(tenant_id, column)`.
- **A polymorphic `record_links` table** for arbitrary any-to-any associations,
  with `CHECK` allowlists on both entity types, a self-link `CHECK`, a unique
  index on `(tenant, pair, relation)` for idempotency, and its own RLS policy.

`ON DELETE` is `SET NULL` everywhere except `activities.lead_id`, which is
`CASCADE` to match its sibling columns (`contact_id`, `deal_id`, `company_id`) —
an activity is meaningless without its subject.

## Consequences

- Two mechanisms to learn. A developer adding a relationship has to decide which,
  and the boundary ("is this part of the entity's identity?") is a judgement call.
- `record_links` rows have no FK integrity to their targets — the polymorphic
  pattern cannot express that. Deleting a record leaves dangling links.
  `verifyReferentialIntegrity()` in `lib/data-integrity.ts` is what detects it.
- `tasks.project_id` was **not** added: `projects.ts` already imports `tasks.ts`,
  so the FK would create an import cycle. Use `record_links` for that pairing
  until the schema modules are untangled.
- `activities` still has both the polymorphic and denormalised mechanisms. Not
  deduplicated here; that is a data migration with its own risk.

## Alternatives considered

- **Nullable FK columns for everything.** Rejected: every new relationship type
  needs a migration, and the column count grows without bound on the entities
  that link to the most things.
- **Polymorphic `record_links` for everything.** Rejected: loses referential
  integrity and index quality on the relationships that carry money and are
  joined on constantly.
