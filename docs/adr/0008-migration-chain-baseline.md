# ADR-0008: Squash the migration chain to a baseline

- **Status:** Proposed — blocked on production provenance
- **Date:** 2026-07-27

## Context

The migration chain cannot build the schema from scratch. Verified against
PostgreSQL 16: it fails at journal position 2.

`0037_flat_sir_ram` is a full `drizzle-kit` snapshot — 213 `CREATE TABLE`,
418 `ADD CONSTRAINT`, 544 `CREATE INDEX`, 33 unique constraints, 1 view — of
which 167 tables were already created by `0000_init`. It sits third in journal
order, so:

```
0037_flat_sir_ram -> ERROR: relation "api_key_usage" already exists
```

and **35 of 40 migrations never run**. CI hides this by provisioning with
`npm run db:sync` (`ci.yml` lines 79, 123) rather than replaying the chain.

An attempt to make `0037` idempotent moved the failure rather than fixing it:

```
ERROR: column "invited_by" referenced in foreign key constraint does not exist
```

That was reverted. A chain that _looks_ fixed but builds an incomplete schema is
worse than one that fails loudly.

## Decision (proposed)

Replace `0000`–`0037` with a single generated baseline representing the current
schema, keep `0038` onward, and mark the baseline as already applied in every
existing environment.

**This is blocked.** The step "mark the baseline as applied per environment"
requires knowing how production was provisioned:

- If production was built with `db:push` / `db:sync`, its
  `drizzle.__drizzle_migrations` table may not reflect the journal at all.
- If it was built with `db:migrate`, the rows exist and the baseline can be
  stamped.
- If it holds live customer data, guessing wrong means replaying `0000_init`
  over real tables.

Two questions must be answered before this proceeds:

1. Was production provisioned with `db:push`/`db:sync` or `db:migrate`?
2. Does it hold live customer data?

## Consequences

- Until this lands, a from-scratch build must use `db:sync`, and disaster recovery
  cannot rely on replaying migrations. That is a real gap in the recovery story:
  restoring schema-from-code and data-from-backup are separate paths.
- `npm run db:verify-chain` exists and **fails today** on purpose, documenting the
  breakage. It is deliberately not wired into CI — it should be added as a
  required gate in the same change that lands the baseline, so it goes from red to
  green once and then stays green.
- `docs/migration-chain-state.md` holds the measured detail.

## Alternatives considered

- **Squash now, guessing at production state.** Rejected: the failure mode is
  replaying `0000_init` over live customer data.
- **Make `0037` idempotent.** Attempted and reverted — see above.
- **Delete the chain and rely on `db:push` permanently.** Rejected: no reviewable
  record of schema change, no rollback, and issue #52 already calls for removing
  `db:push` from production use.
