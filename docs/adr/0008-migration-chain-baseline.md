# ADR-0008: Squash the migration chain to a baseline

- **Status:** Proposed — no longer blocked on knowing the provenance
- **Date:** 2026-07-27

> **Update.** This ADR originally said the squash was blocked on someone
> remembering how production was provisioned. It is not: the answer is
> discoverable, and the handling turned out to be the same either way.
>
> `npm run db:diagnose` reports it read-only, and `scripts/migrate.ts` already
> detects the case at deploy time. What actually blocked this was a **bug** in
> that detection, now fixed — see "The recovery path was writing to the wrong
> table" below.

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

## The recovery path was writing to the wrong table

`scripts/migrate.ts` has always had a recovery branch for exactly this situation:
if the schema exists but the ledger is empty, stamp the journal instead of
replaying it. It created and seeded an **unqualified** `"__drizzle_migrations"`,
which resolves to `public`. But `migrate()` consults
`"drizzle"."__drizzle_migrations"`. So recovery seeded a table drizzle never
reads.

Measured on PostgreSQL 16 against a `db:push`-style database (schema present,
two tenants, real rows, no ledger), running `npm run db:migrate --yes`:

```
public.__drizzle_migrations   = 40    <- recovery seeded this
drizzle.__drizzle_migrations  = 0     <- the one migrate() reads
then: 42P07 relation "..." already exists, exit 1
```

It tried to replay every migration from `0000_init` over the live schema. The
data survived only because the first failing statement happened to be a
`CREATE TABLE`; a migration opening with `ALTER` or `DROP` would have damaged it.

Fixed: the recovery branch now creates and seeds `"drizzle"."__drizzle_migrations"`.
drizzle decides what is outstanding by comparing each migration's `folderMillis`
against the newest `created_at` in that table — not by hash — so seeding the
journal's `when` values is sufficient to mark them applied. Re-measured on the
same fixture: `drizzle = 40`, no migration SQL executed, exit 0, rows intact.

## Decision (proposed)

Replace `0000`–`0037` with a single generated baseline representing the current
schema, and keep `0038` onward.

Marking the baseline as already applied no longer needs a human to remember
anything, because the two cases collapse:

- **Provisioned with `db:push`/`db:sync`, or restored from a dump.** The ledger
  is empty, so `migrate.ts`'s recovery branch stamps the journal and executes
  nothing.
- **Provisioned with `db:migrate`.** The ledger already reflects the journal and
  the baseline is stamped against it.

Either way no migration SQL runs against an existing schema. `npm run db:diagnose`
reports which case a given environment is in, read-only, so it can be confirmed
rather than assumed before the squash lands.

The remaining prerequisite is therefore mechanical, not informational: the
`migrate.ts` fix must be deployed **before** the squashed baseline, so that any
environment whose ledger is empty stamps rather than replays.

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
